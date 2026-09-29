import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { resolvePayment, rejectPayment } from '../shopify';
import { getSessionStore } from '../store';

const router = express.Router();

const AFCONWAVE_API_URL = process.env.AFCONWAVE_API_URL || 'https://api.afconwave.com/api/v1';
const AFCONWAVE_SECRET_KEY = process.env.AFCONWAVE_SECRET_KEY!;
const AFCONWAVE_WEBHOOK_SECRET = process.env.AFCONWAVE_WEBHOOK_SECRET!;

const sessionMap = getSessionStore();

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

        const afconwaveResponse = await axios.post(
            `${AFCONWAVE_API_URL}/payments`,
            {
                amount: Math.round(parseFloat(amount) * 100),
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

        const payloadData = afconwaveResponse.data?.data || afconwaveResponse.data || {};
        const { id: afconwaveReference, checkout_url } = payloadData;

        if (!checkout_url) {
            res.status(502).json({ error: 'AfconWave did not return a checkout URL' });
            return;
        }

        await sessionMap.set(afconwaveReference, shopifyPaymentId);
        res.json({ redirect_url: checkout_url });
    } catch (error: any) {
        console.error('[SHOPIFY INITIATE] Error:', error.message);
        res.status(500).json({ error: 'Failed to initiate AfconWave payment session' });
    }
});

router.post('/resolve', async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-afconwave-signature'] as string;
    const rawBody = req.body;

    const expectedSig = crypto
        .createHmac('sha256', AFCONWAVE_WEBHOOK_SECRET || '')
        .update(rawBody)
        .digest('hex');

    if (!signature || signature.length !== expectedSig.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
    }

    const payload = JSON.parse(rawBody.toString());
    const eventName = payload.type || payload.event;
    const timestamp = payload.timestamp;
    const data = payload.data;

    if (timestamp) {
        const ts = Number(timestamp);
        const webhookMs = ts > 10_000_000_000 ? ts : ts * 1000;
        const age = Math.abs(Date.now() - webhookMs) / 1000;
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

    try {
        if (eventName === 'payment.success') {
            await resolvePayment(shopifyPaymentId);
        } else if (eventName === 'payment.failed') {
            await rejectPayment(shopifyPaymentId, 'PROCESSING_ERROR');
        }
        await sessionMap.delete(afconwaveReference);
    } catch (error: any) {
        console.error('[SHOPIFY RESOLVE] Error notifying Shopify:', error.message);
    }

    res.status(200).send('OK');
});

router.get('/success', (_req: Request, res: Response) => {
    res.send('<html><body><h1>Payment Successful</h1></body></html>');
});

router.get('/cancel', (_req: Request, res: Response) => {
    res.send('<html><body><h1>Payment Cancelled</h1></body></html>');
});

export default router;
