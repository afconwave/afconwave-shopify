import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { resolvePayment, rejectPayment } from '../shopify';

const router = express.Router();

const AFCONWAVE_API_URL = process.env.AFCONWAVE_API_URL || 'https://api.afconwave.com/v1';
const AFCONWAVE_SECRET_KEY = process.env.AFCONWAVE_SECRET_KEY!;
const AFCONWAVE_WEBHOOK_SECRET = process.env.AFCONWAVE_WEBHOOK_SECRET!;

// In-memory map to link AfconWave payment refs → Shopify payment session IDs
// In production, use Redis or a DB for persistence
const sessionMap = new Map<string, string>();

/**
 * @route   POST /payment/initiate
 * @desc    Shopify calls this when a buyer clicks Pay at checkout.
 *          We create an AfconWave payment session and redirect the buyer.
 * @access  Public (called by Shopify)
 */
router.post('/initiate', async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            id: shopifyPaymentId,
            gid,
            amount,
            currency,
            test,
            merchant_locale,
            payment_method,
            proposed_at,
            customer
        } = req.body;

        if (!shopifyPaymentId || !amount || !currency) {
            res.status(400).json({ error: 'Missing required payment fields from Shopify' });
            return;
        }

        // Create AfconWave Checkout Session
        const afconwaveResponse = await axios.post(
            `${AFCONWAVE_API_URL}/checkout/session`,
            {
                amount: parseFloat(amount),
                currency: currency.toUpperCase(),
                description: `Shopify Order — ${shopifyPaymentId}`,
                customer_email: customer?.email,
                success_url: `${process.env.APP_URL}/payment/success?shopify_id=${shopifyPaymentId}`,
                cancel_url: `${process.env.APP_URL}/payment/cancel?shopify_id=${shopifyPaymentId}`,
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

        const { reference, checkout_url } = afconwaveResponse.data?.data || {};

        if (!checkout_url) {
            res.status(502).json({ error: 'AfconWave did not return a checkout URL' });
            return;
        }

        // Store the mapping: AfconWave reference → Shopify Payment ID
        sessionMap.set(reference, shopifyPaymentId);

        // Return redirect URL to Shopify — Shopify will redirect the buyer here
        res.json({ redirect_url: checkout_url });

    } catch (error: any) {
        console.error('[SHOPIFY INITIATE] Error:', error.message);
        res.status(500).json({ error: 'Failed to initiate AfconWave payment session' });
    }
});

/**
 * @route   POST /payment/resolve
 * @desc    AfconWave webhook calls this after a payment succeeds or fails.
 *          We verify the HMAC signature and notify Shopify to complete/reject the order.
 * @access  Public (webhook from AfconWave)
 */
router.post('/resolve', async (req: Request, res: Response): Promise<void> => {
    // 1. Verify AfconWave HMAC Signature
    const signature = req.headers['x-afconwave-signature'] as string;
    const rawBody = req.body; // raw buffer (from express.raw middleware)

    const expectedSig = crypto
        .createHmac('sha256', AFCONWAVE_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    if (!signature || signature !== expectedSig) {
        console.warn('[SHOPIFY RESOLVE] Invalid webhook signature — rejecting');
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    // 2. Parse payload
    const payload = JSON.parse(rawBody.toString());
    const { event, data } = payload;
    const afconwaveReference = data?.reference;
    const shopifyPaymentId = sessionMap.get(afconwaveReference);

    if (!shopifyPaymentId) {
        console.warn(`[SHOPIFY RESOLVE] No Shopify session found for reference: ${afconwaveReference}`);
        res.status(200).send('OK'); // Acknowledge webhook even if unknown
        return;
    }

    // 3. Notify Shopify based on event type
    try {
        if (event === 'PAYMENT_SUCCESS') {
            await resolvePayment(shopifyPaymentId);
            console.log(`[SHOPIFY RESOLVE] Order resolved for Shopify payment ${shopifyPaymentId}`);
        } else if (event === 'PAYMENT_FAILED' || event === 'PAYMENT_CANCELLED') {
            await rejectPayment(shopifyPaymentId, 'PROCESSING_ERROR');
            console.log(`[SHOPIFY RESOLVE] Order rejected for Shopify payment ${shopifyPaymentId}`);
        }

        // Clean up session map
        sessionMap.delete(afconwaveReference);

    } catch (error: any) {
        console.error('[SHOPIFY RESOLVE] Error notifying Shopify:', error.message);
    }

    res.status(200).send('OK');
});

/**
 * @route   GET /payment/success
 * @desc    Buyer is redirected here after successful payment at AfconWave
 */
router.get('/success', (req: Request, res: Response) => {
    res.send(`
        <html>
          <head><title>Payment Successful</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <h1>✅ Payment Successful!</h1>
            <p>Your payment has been confirmed. You will be redirected back to the store shortly.</p>
            <script>setTimeout(() => window.history.back(), 3000);</script>
          </body>
        </html>
    `);
});

/**
 * @route   GET /payment/cancel
 * @desc    Buyer is redirected here after cancelling payment at AfconWave
 */
router.get('/cancel', (req: Request, res: Response) => {
    res.send(`
        <html>
          <head><title>Payment Cancelled</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 60px;">
            <h1>❌ Payment Cancelled</h1>
            <p>Your payment was cancelled. Redirecting you back to the store...</p>
            <script>setTimeout(() => window.history.back(), 3000);</script>
          </body>
        </html>
    `);
});

export default router;
