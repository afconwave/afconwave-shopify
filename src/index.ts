import express from 'express';
import dotenv from 'dotenv';
import paymentRoutes from './routes/payment';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// ─── Middleware ───────────────────────────────────────────────────────────────
// Raw body needed for HMAC webhook verification
app.use('/payment/resolve', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'AfconWave Shopify Payments App',
        version: '1.0.0',
        icon: '/assets/afconwave_shopify_logo.png'
    });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/payment', paymentRoutes);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[SHOPIFY APP] AfconWave Shopify Payments middleware running on port ${PORT}`);
});

export default app;
