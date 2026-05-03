# AfconWave Shopify Payments App — Deployment Guide

This is a **standalone Node.js middleware application** — not a traditional Shopify plugin. It acts as the secure bridge between Shopify's Payment Sessions API and the AfconWave checkout system.

## Architecture
```
Shopify Checkout
      ↓
POST /payment/initiate  (Shopify calls this)
      ↓
AfconWave creates checkout session → returns redirect URL
      ↓
Buyer completes payment on AfconWave hosted page
      ↓
AfconWave fires webhook → POST /payment/resolve
      ↓
This middleware notifies Shopify via GraphQL → Order Confirmed
```

## Prerequisites
1. A **Shopify Partners account** at https://partners.shopify.com
2. An **AfconWave merchant account** with live API keys
3. A **public HTTPS deployment** (this app cannot run on localhost for production)

## Environment Variables
Create a `.env` file:
```env
PORT=3005
AFCONWAVE_API_URL=https://api.afconwave.com/v1
AFCONWAVE_SECRET_KEY=sk_live_your_key_here
AFCONWAVE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
SHOPIFY_STORE_DOMAIN=yourstore.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_your_admin_token
APP_URL=https://your-deployed-app-url.com
```

## Step 1: Deploy this app
Deploy to **Vercel**, **Railway**, or **Heroku** so it has a public HTTPS URL.

### Deploy to Railway (Recommended)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```
Note your deployment URL (e.g., `https://afconwave-shopify.up.railway.app`).

## Step 2: Register on Shopify Partners
1. Go to https://partners.shopify.com → Apps → Create App.
2. Select **Payments App** as the app type.
3. Set the **Payment initiation URL** to: `https://your-app-url.com/payment/initiate`
4. Set the **Refund session URL** to: `https://your-app-url.com/payment/resolve`

## Step 3: Install on Shopify Store
1. In your Shopify store Admin → Settings → Payments.
2. Under "Alternative Payment Methods", find your registered app and activate it.

## Step 4: Set up AfconWave Webhook
In your AfconWave merchant dashboard:
1. Go to Settings → Webhooks.
2. Add a new webhook URL: `https://your-app-url.com/payment/resolve`
3. Subscribe to events: `PAYMENT_SUCCESS`, `PAYMENT_FAILED`.

## Local Development
```bash
npm install
npm run dev
```
Use [ngrok](https://ngrok.com) to expose localhost for local Shopify testing:
```bash
ngrok http 3005
```
