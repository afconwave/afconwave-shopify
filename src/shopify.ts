import axios from 'axios';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN!; // e.g. mystore.myshopify.com
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const SHOPIFY_API_VERSION = '2024-04';

const SHOPIFY_GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

/**
 * Calls Shopify's GraphQL API to mark a payment session as RESOLVED (successful).
 * This is the final handshake that tells Shopify the buyer has successfully paid.
 */
export async function resolvePayment(shopifyPaymentId: string): Promise<void> {
    const mutation = `
        mutation paymentSessionResolve($id: ID!) {
            paymentSessionResolve(id: $id) {
                paymentSession {
                    id
                    state { code }
                    nextAction { action context { ... on PaymentSessionActionsRedirect { redirectUrl } } }
                }
                userErrors { field message }
            }
        }
    `;

    const response = await axios.post(
        SHOPIFY_GRAPHQL_URL,
        { query: mutation, variables: { id: shopifyPaymentId } },
        {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            },
        }
    );

    const errors = response.data?.data?.paymentSessionResolve?.userErrors;
    if (errors?.length > 0) {
        throw new Error(`[SHOPIFY] Failed to resolve payment: ${JSON.stringify(errors)}`);
    }

    console.log(`[SHOPIFY] Payment ${shopifyPaymentId} resolved successfully.`);
}

/**
 * Calls Shopify's GraphQL API to mark a payment session as REJECTED (failed/cancelled).
 */
export async function rejectPayment(shopifyPaymentId: string, reason: string = 'PROCESSING_ERROR'): Promise<void> {
    const mutation = `
        mutation paymentSessionReject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
            paymentSessionReject(id: $id, reason: $reason) {
                paymentSession {
                    id
                    state { code }
                }
                userErrors { field message }
            }
        }
    `;

    const response = await axios.post(
        SHOPIFY_GRAPHQL_URL,
        {
            query: mutation,
            variables: {
                id: shopifyPaymentId,
                reason: { code: reason } // PROCESSING_ERROR | RISKY | AUTHENTICATION_FAILED
            }
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            },
        }
    );

    const errors = response.data?.data?.paymentSessionReject?.userErrors;
    if (errors?.length > 0) {
        throw new Error(`[SHOPIFY] Failed to reject payment: ${JSON.stringify(errors)}`);
    }

    console.log(`[SHOPIFY] Payment ${shopifyPaymentId} rejected with reason: ${reason}`);
}
