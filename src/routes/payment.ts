import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { resolvePayment, rejectPayment } from '../shopify';
import { getSessionStore } from '../store';

const router = express.Router();

const AFCONWAVE_API_URL = process.env.AFCONWAVE_API_URL || 'https://api.afconwave.com/api/v1';
const AFCONWAVE_SECRET_KEY = process.env.AFCONWAVE_SECRET_KEY!;
const AFCONWAVE_WEBHOOK_SECRET = process.env.AFCONWAVE_WEBHOOK_SECRET!;

// Persistent session store — see ../store.ts for production config (Redis, etc.)
const sessionMap = getSessionStore();

/**
 * @route   POST /payment/initiate
 * @desc    Shopify calls this when a buyer clicks Pay at checkout.
 */
router.post('/initiate', async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            id: shopifyPaymentId,
            gid,
            amount,
            currency,
            test,
            customer
        } = req.body;

        if (!shopifyPaymentId || !amount || !currency) {
            res.status(400).json({ error: 'Missing required payment fields from Shopify' });
            return;
        }

        // 1. Create AfconWave Payment (Minor Units)
        const afconwaveResponse = await axios.post(
            `${AFCONWAVE_API_URL}/payments`,
            {
                amount: Math.round(parseFloat(amount) * 100), // convert to minor units
                currency: currency.toUpperCase(),
                description: `Shopify Order — ${shopifyPaymentId}`,
                customer_email: customer?.email,
                callback_url: `${process.env.APP_URL}/payment/success?shopify_id=${shopifyPaymentId}`,
                metadata: {
                    shopify_payment_id: shopifyPaymentId,
                    shopify_gid: gid,
                    is_test: test
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${AFCONWAVE_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const { id: afconwaveReference, checkout_url } = afconwaveResponse.data?.data || {};

        if (!checkout_url) {
            res.status(502).json({ error: 'AfconWave did not return a checkout URL' });
            return;
        }

        // 2. Store the mapping (persisted via SessionStore)
        await sessionMap.set(afconwaveReference, shopifyPaymentId);

        res.json({ redirect_url: checkout_url });

    } catch (error: any) {
        console.error('[SHOPIFY INITIATE] Error:', error.message);
        res.status(500).json({ error: 'Failed to initiate AfconWave payment session' });
    }
});

/**
 * @route   POST /payment/resolve
 * @desc    AfconWave webhook callback with Replay Protection
 */
router.post('/resolve', async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-afconwave-signature'] as string;
    const rawBody = req.body; // raw buffer

    // 1. Verify Signature
    const expectedSig = crypto
        .createHmac('sha256', AFCONWAVE_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    const payload = JSON.parse(rawBody.toString());
    const { type, timestamp, data } = payload;

    // 2. Replay Protection (5 min tolerance)
    if (timestamp) {
        const age = Math.abs(Date.now() - timestamp) / 1000;
        if (age > 300) {
            res.status(401).json({ error: 'Timestamp tolerance exceeded' });
            return;
        }
    }

    const afconwaveReference = data?.id;
    const shopifyPaymentId = await sessionMap.get(afconwaveReference);

    if (!shopifyPaymentId) {
        res.status(200).send('OK'); 
        return;
    }

    // 3. Notify Shopify
    try {
        if (type === 'payment.success') {
            await resolvePayment(shopifyPaymentId);
        } else if (type === 'payment.failed') {
            await rejectPayment(shopifyPaymentId, 'PROCESSING_ERROR');
        }
        await sessionMap.delete(afconwaveReference);
    } catch (error: any) {
        console.error('[SHOPIFY RESOLVE] Error notifying Shopify:', error.message);
    }

    res.status(200).send('OK');
});

router.get('/success', (req: Request, res: Response) => {
    res.send(`
        <html>
          <head>
            <title>Payment Successful</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
              .card { background: white; padding: 40px; border-radius: 24px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
              .icon { background: #ecfdf5; color: #10b981; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 32px; }
              h1 { font-size: 24px; margin: 0 0 8px; }
              p { color: #6b7280; font-size: 14px; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✓</div>
              <h1>Payment Successful</h1>
              <p>Your order has been confirmed. You will be redirected back to the store in a few seconds.</p>
              <script>setTimeout(() => window.history.back(), 3000);</script>
            </div>
          </body>
        </html>
    `);
});

router.get('/cancel', (req: Request, res: Response) => {
    res.send(`
        <html>
          <head><title>Payment Cancelled</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <h1>Payment Cancelled</h1>
            <p>Redirecting you back to the store...</p>
            <script>setTimeout(() => window.history.back(), 3000);</script>
          </body>
        </html>
    `);
});

export default router;
