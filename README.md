# BTCPay Digital Fulfillment for Netlify

A small serverless template for selling digital downloads through a BTCPay Server Point of Sale app and delivering them automatically after invoice settlement.

It is designed for static stores: the buyer clicks a normal HTML form, pays a BTCPay invoice, and BTCPay redirects them back to a Netlify Function. The function independently verifies the invoice through BTCPay's Greenfield API before releasing the zip.

## What it handles

- verifies the invoice server-side instead of trusting the browser redirect;
- maps BTCPay `metadata.itemCode` / POS `choiceKey` values to product zips;
- returns a waiting page for `New`, `Processing`, and `Paid` invoices;
- refuses expired, invalid, unpaid, or unknown-product invoices;
- serves small zips directly;
- serves large zips in verified chunks and reassembles them in the buyer's browser, avoiding the serverless response-size ceiling;
- requires no database, customer account, email capture, or custodial payment processor.

## Architecture

```text
static HTML form
  -> BTCPay POS invoice
  -> buyer pays
  -> BTCPay redirect template with {InvoiceId}
  -> Netlify Function checks Greenfield invoice status
  -> zip download only when status is Settled
```

BTCPay remains the payment source of truth. Netlify is only the delivery verifier/static host.

## Repository layout

```text
netlify/functions/fulfill.js       serverless delivery verifier
netlify/functions/data/products.js generated embedded product data
scripts/build-product-data.js      converts products/*.zip into function data
products.config.json               itemCode -> product metadata mapping
products/                          put distributable zips here before building
netlify.toml                       Netlify publish/functions config
```

## Setup

### 1. Add products

Put each deliverable zip in `products/`, then edit `products.config.json`:

```json
{
  "example": {
    "name": "Example Product",
    "zip": "example-product.zip",
    "filename": "example-product.zip"
  }
}
```

The object key (`example` above) must exactly match the BTCPay POS item key / `choiceKey` that becomes `invoice.metadata.itemCode`.

Generate the embedded zip modules:

```bash
node scripts/build-product-data.js
```

Large files increase function bundle size. This template is best for small-to-medium digital downloads. The included chunked downloader exists because even a base64 response slightly over 6 MB can exceed serverless response limits.

### 2. Configure BTCPay

Create or edit a BTCPay Point of Sale app. Each product key/choice key must match `products.config.json`.

Set the POS redirect URL template to your deployed function and include BTCPay's invoice placeholder:

```text
https://your-site.netlify.app/.netlify/functions/fulfill?invoice={InvoiceId}
```

Enable automatic redirect if desired. Keep manual payment links available while testing.

A static HTML checkout button can post directly to a public POS app:

```html
<form action="https://pay.example/apps/YOUR_APP_ID/pos" method="post">
  <input type="hidden" name="choiceKey" value="example">
  <button type="submit">Buy</button>
</form>
```

Test this against your own BTCPay instance; app settings and versions can vary.

### 3. Create a least-privilege API key

Create a BTCPay API key that can view invoices for the store. Do not use an admin key in Netlify. Store it as a secret environment variable.

### 4. Configure Netlify

Set these environment variables in Netlify:

```text
BTCPAY_HOST=https://pay.example
BTCPAY_STORE_ID=your_store_id
BTCPAY_API_KEY=your_least_privilege_api_key
```

Deploy:

```bash
netlify deploy --prod
```

The included `netlify.toml` publishes `public/` and bundles `netlify/functions`.

## Testing

Do not mark real invoices paid manually in production unless you intentionally use a BTCPay test/storeflow designed for that. A safe test sequence is:

1. create a real invoice from the public POS form;
2. confirm the redirect URL contains the invoice ID;
3. verify unpaid invoices return the payment-required/processing page;
4. make a small real payment or use an isolated BTCPay test instance;
5. verify the settled invoice downloads the exact zip bytes;
6. verify an expired invoice does not download.

For local logic tests you can mock `global.fetch` and call the handler directly, but that is not a substitute for one real end-to-end payment.

## Security notes

- Treat invoice IDs as bearer receipt links. Anyone with the invoice ID can download while the receipt link remains valid.
- Never expose BTCPay admin keys or wallet xpub/private keys in the deployed static site.
- Do not trust client-supplied product names, prices, or payment status.
- Keep the BTCPay API key limited to the minimum invoice-read permission available.
- The chunked downloader verifies the same settled invoice for every part; it does not expose a public zip URL.
- Embedded product zips are inside the deployed function bundle. Use access-controlled deployment logs and do not publish build artifacts unintentionally.

## License

MIT. See `LICENSE`.
