// /api/save-to-shopify-files.js
export const config = { api: { bodyParser: false } }; // we read multipart manually

// Simple CORS for your storefront
function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://3tprintsolutions.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

const GQL = async (query, variables) => {
  const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
};

// helper: read multipart form with Web API Request.formData()
async function readFormData(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';
  const r = new Request('http://local', { method: 'POST', headers: { 'content-type': contentType }, body });
  return await r.formData();
}

// GraphQL mutations
const STAGED_UPLOADS_CREATE = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters { name value }
    }
    userErrors { field message }
  }
}
`;

const FILE_CREATE = `
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { alt url ... on MediaImage { image { url } } }
    userErrors { field message }
  }
}
`;

export default async function handler(req, res){
  if (setCORS(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    // 1) read form
    const form = await readFormData(req);

    // 2) collect files from the form (name="art_files")
    const files = [];
    const maybeFile = form.getAll('art_files');
    for (const f of maybeFile) {
      if (typeof f === 'object' && 'arrayBuffer' in f) {
        files.push(f); // Web File object
      }
    }

    if (!files.length) {
      return res.status(200).json({ ok: true, saved: [], note: 'No files in submission' });
    }

    // 3) request staged uploads from Shopify
    const inputs = files.map((file) => ({
      resource: "FILE",
      filename: file.name || 'upload',
      mimeType: file.type || 'application/octet-stream',
      httpMethod: "POST"
    }));

    const staged = await GQL(STAGED_UPLOADS_CREATE, { input: inputs });
    const targets = staged.stagedUploadsCreate.stagedTargets;
    if (!targets?.length) throw new Error('No staged targets from Shopify');
    if (targets.length !== files.length) throw new Error('Target/file count mismatch');

    // 4) upload each file to staged S3 URL
    const uploadedResourceUrls = [];
    for (let i = 0; i < files.length; i++) {
      const t = targets[i];
      const file = files[i];
      const fd = new FormData();
      for (const p of t.parameters) fd.append(p.name, p.value);
      fd.append('file', new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' }), file.name || 'upload');

      const s3Res = await fetch(t.url, { method: 'POST', body: fd });
      if (!s3Res.ok) throw new Error(`Staged upload failed: ${await s3Res.text()}`);
      uploadedResourceUrls.push(t.resourceUrl);
    }

    // 5) finalize by creating Files in Shopify (visible in Content → Files)
    const createInputs = uploadedResourceUrls.map((resourceUrl, idx) => ({
      originalSource: resourceUrl,
      contentType: "FILE",
      alt: files[idx]?.name || 'Upload'
    }));

    const created = await GQL(FILE_CREATE, { files: createInputs });

    const fileUrls = (created.fileCreate.files || []).map(f => f?.url || f?.image?.url || null).filter(Boolean);

    return res.status(200).json({ ok: true, count: fileUrls.length, urls: fileUrls });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
