const entries = require('./data/products');

const products = Object.fromEntries(entries.map((product) => [product.itemCode, product]));

const ZIP_CHUNK_SIZE = 1800000;
const DIRECT_ZIP_LIMIT = 4000000;

const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:640px;margin:24px;padding:32px;border:1px solid #334155;border-radius:18px;background:#111827;box-shadow:0 20px 60px #0008}h1{font-size:1.6rem;margin:0 0 12px}p{line-height:1.6;color:#cbd5e1}a{color:#7dd3fc}code{background:#1e293b;border-radius:6px;padding:2px 6px}</style></head><body><main class="card">${body}</main></body></html>`;

const chunkedDownloadHtml = (product, invoiceId) => {
  const parts = Math.ceil(product.data.length / ZIP_CHUNK_SIZE);
  const script = `(async()=>{const parts=${parts},invoice=${JSON.stringify(invoiceId)},name=${JSON.stringify(product.filename)};try{const pieces=[];for(let i=0;i<parts;i++){const r=await fetch(location.pathname+'?invoice='+encodeURIComponent(invoice)+'&part='+i);if(!r.ok)throw new Error('download part '+i+' failed');pieces.push(await r.text())}const b64=pieces.join(''),bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();document.getElementById('status').textContent='Download started. If it did not, refresh or contact the seller with your invoice ID.'}catch(e){document.getElementById('status').textContent='Download failed. Please refresh or contact the seller with your invoice ID.'}})()`;
  return html('Download ready', `<h1>Download ready</h1><p>Your ${product.name} payment is confirmed. Preparing <code>${product.filename}</code>…</p><p id="status">Download should start automatically.</p><script>${script}</script>`);
};

const response = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
  body,
});

exports.handler = async (event) => {
  const invoiceId = (event.queryStringParameters?.invoice || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(invoiceId)) {
    return response(400, html('Missing order', '<h1>Missing order</h1><p>Return to the store and complete checkout again.</p>'));
  }

  const host = (process.env.BTCPAY_HOST || '').replace(/\/$/, '');
  const storeId = process.env.BTCPAY_STORE_ID;
  const apiKey = process.env.BTCPAY_API_KEY;
  if (!host || !storeId || !apiKey) {
    return response(500, html('Delivery unavailable', '<h1>Delivery unavailable</h1><p>The delivery service is not configured. Contact the seller with your invoice ID.</p>'));
  }

  let invoice;
  try {
    const r = await fetch(`${host}/api/v1/stores/${storeId}/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { authorization: `token ${apiKey}` },
    });
    if (r.status === 404) return response(404, html('Order not found', '<h1>Order not found</h1><p>Check the link from your BTCPay receipt. The invoice ID could not be found.</p>'));
    if (!r.ok) throw new Error(`BTCPay ${r.status}`);
    invoice = await r.json();
  } catch (_) {
    return response(502, html('Payment check unavailable', '<h1>Payment check unavailable</h1><p>Your payment could not be checked right now. Please refresh in a minute or contact the seller.</p>'));
  }

  const itemCode = invoice.metadata?.itemCode;
  const product = products[itemCode];
  if (!product) return response(400, html('Unknown product', '<h1>Unknown product</h1><p>This invoice does not match a downloadable product.</p>'));

  if (invoice.status === 'Settled') {
    const partRaw = event.queryStringParameters?.part;
    if (partRaw !== undefined) {
      const part = Number(partRaw);
      const start = part * ZIP_CHUNK_SIZE;
      if (!Number.isInteger(part) || part < 0 || start >= product.data.length) {
        return response(400, html('Invalid download part', '<h1>Invalid download part</h1><p>Refresh your original delivery link.</p>'));
      }
      return {
        statusCode: 200,
        headers: {
          'cache-control': 'private, max-age=3600',
          'content-type': 'text/plain; charset=ascii',
          'x-content-type-options': 'nosniff',
        },
        body: product.data.slice(start, start + ZIP_CHUNK_SIZE),
      };
    }

    if (product.data.length > DIRECT_ZIP_LIMIT) {
      return response(200, chunkedDownloadHtml(product, invoiceId));
    }

    return {
      statusCode: 200,
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-disposition': `attachment; filename="${product.filename}"`,
        'content-type': 'application/zip',
        'x-content-type-options': 'nosniff',
      },
      body: product.data,
      isBase64Encoded: true,
    };
  }

  if (['New', 'Processing', 'Paid'].includes(invoice.status)) {
    return response(202, html('Payment processing', `<h1>Payment processing</h1><p>Your ${product.name} payment has been detected and is waiting for confirmation. This page refreshes automatically; keep it open or bookmark it.</p><p><code>${invoiceId}</code></p><meta http-equiv="refresh" content="15">`));
  }

  return response(402, html('Payment not complete', `<h1>Payment not complete</h1><p>Invoice status: <code>${invoice.status}</code>. Complete payment from your BTCPay checkout link, then return here.</p>`));
};
