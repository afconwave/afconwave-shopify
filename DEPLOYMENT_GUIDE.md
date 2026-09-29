# AfconWave Shopify Payments App — Deployment Guide

Standalone Node.js middleware between Shopify Payments and AfconWave checkout.

## Environment Variables

```env
PORT=3005
AFCONWAVE_API_URL=https://api.afconwave.com/api/v1
AFCONWAVE_SECRET_KEY=afc_sk_live_your_key_here
AFCONWAVE_WEBHOOK_SECRET=afc_wh_live_your_webhook_secret_here
SHOPIFY_STORE_DOMAIN=yourstore.myshopify.com
SHOPIFY_ADMIN_API_TOKEN=shpat_your_admin_token
APP_URL=https://your-deployed-app-url.com
```

Keys: `afc_sk_test_` sandbox, `afc_sk_live_` production. Not `afw_`.

Payment initiation URL: `https://your-app-url.com/payment/initiate`  
Webhook / resolve URL: `https://your-app-url.com/payment/resolve`
