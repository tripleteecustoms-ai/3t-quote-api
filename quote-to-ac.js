// /api/quote-to-ac.js
// Sync form fields to ActiveCampaign and trigger automation
function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://3tprintsolutions.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Api-Token');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export default async function handler(req, res){
  if (setCORS(req, res)) return;
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const body = req.body || {};
    const { name='', email='', phone='' } = body;
    if(!email) return res.status(400).json({error:'Email required'});

    const AC_API_URL = process.env.AC_API_URL;
    const AC_API_KEY = process.env.AC_API_KEY;
    const AC_LIST_ID = process.env.AC_LIST_ID;
    const AC_AUTOMATION_ID = process.env.AC_AUTOMATION_ID;
    const AC_TAG_ID = process.env.AC_TAG_ID; // optional

    const FIELD_IDS = {
      // if you know numeric custom field IDs, put them here (these win)
      // garmentType: '123'
    };

    const FIELD_NAMES = {
      garmentType: 'Garment Type',
      garmentColor: 'Garment Color',
      garmentQuality: 'Garment Quality',
      garmentSource: 'Garment Source',
      printType: 'Print Type',
      screenColors: 'Screen Color Count',
      stitches: 'Embroidery Stitch Count',
      printSize: 'Print Size',
      artW: 'Artwork Width (in)',
      artH: 'Artwork Height (in)',
      locations: 'Print Locations',
      rushFee: 'Rush Fee',
      ship_pickup: 'Pickup or Shipping',
      tax_exempt: 'Tax Exempt',
      notes: 'Project Notes',
      total_per: 'Quote – Per Shirt',
      total_sub: 'Quote – Subtotal',
      total_tax: 'Quote – Tax',
      total_total: 'Quote – Total'
    };

    const headers = { 'Api-Token': AC_API_KEY, 'Content-Type':'application/json' };

    const _fieldCache = { map:null, at:0 };
    const resolveFieldId = async (key) => {
      if (FIELD_IDS[key]) return String(FIELD_IDS[key]);
      const now = Date.now();
      const fresh = _fieldCache.map && (now - _fieldCache.at < 10*60*1000);
      if (!fresh) {
        const resp = await fetch(`${AC_API_URL}/api/3/fields?limit=200`, { headers: { 'Api-Token': AC_API_KEY } });
        if (!resp.ok) throw new Error('Failed to load AC fields');
        const data = await resp.json();
        const m = {};
        for (const f of (data?.fields||[])) if (f?.title) m[f.title.trim().toLowerCase()] = String(f.id);
        _fieldCache.map = m; _fieldCache.at = now;
      }
      const title = FIELD_NAMES[key];
      if (!title) return null;
      return _fieldCache.map[title.trim().toLowerCase()] || null;
    };

    const [firstName, ...restNames] = (name||'').split(' ');
    const lastName = restNames.join(' ').trim();

    const fieldValues = [];
    const addFV = async (key, value) => {
      const id = await resolveFieldId(key);
      if (id && value !== undefined && value !== null && String(value).length) {
        fieldValues.push({ field: String(id), value: String(value) });
      }
    };

    await addFV('garmentType', body.garmentType);
    await addFV('garmentColor', body.garmentColor);
    await addFV('garmentQuality', body.garmentQuality);
    await addFV('garmentSource', body.garmentSource);
    await addFV('printType', body.printType);
    await addFV('screenColors', body.screenColors);
    await addFV('stitches', body.stitches);
    await addFV('printSize', body.printSize);
    await addFV('artW', body.artW);
    await addFV('artH', body.artH);
    await addFV('locations', body.locations);
    await addFV('rushFee', body.rushFee);
    await addFV('ship_pickup', body.ship_pickup);
    await addFV('tax_exempt', body.tax_exempt);
    await addFV('notes', body.notes);
    if(body?.totals){
      await addFV('total_per', body.totals.per);
      await addFV('total_sub', body.totals.sub);
      await addFV('total_tax', body.totals.tax);
      await addFV('total_total', body.totals.total);
    }

    const contactPayload = { contact: { email, phone, firstName: firstName || undefined, lastName: lastName || undefined, fieldValues } };
    const syncResp = await fetch(`${AC_API_URL}/api/3/contact/sync`, { method:'POST', headers, body: JSON.stringify(contactPayload) });
    if(!syncResp.ok) return res.status(syncResp.status).json({error:'Contact sync failed'});
    const syncData = await syncResp.json();
    const contactId = syncData?.contact?.id;
    if(!contactId) return res.status(500).json({error:'No contact id returned'});

    if(AC_LIST_ID){
      const listResp = await fetch(`${AC_API_URL}/api/3/contactLists`, {
        method:'POST', headers,
        body: JSON.stringify({ contactList: { list: String(AC_LIST_ID), contact: String(contactId), status: 1 } })
      });
      if(!listResp.ok && listResp.status !== 409) return res.status(listResp.status).json({error:'List subscribe failed'});
    }

    if(AC_AUTOMATION_ID){
      const autoResp = await fetch(`${AC_API_URL}/api/3/automations/${AC_AUTOMATION_ID}/contacts`, {
        method:'POST', headers, body: JSON.stringify({ contact: { id: String(contactId) } })
      });
      if(!autoResp.ok && autoResp.status !== 409) return res.status(autoResp.status).json({error:'Automation add failed'});
    }

    if(AC_TAG_ID){
      const tagResp = await fetch(`${AC_API_URL}/api/3/contactTags`, {
        method:'POST', headers, body: JSON.stringify({ contactTag: { contact: String(contactId), tag: String(AC_TAG_ID) } })
      });
      if(!tagResp.ok && tagResp.status !== 409) return res.status(tagResp.status).json({error:'Tag add failed'});
    }

    return res.status(200).json({ ok:true, contactId });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: String(err?.message||err) });
  }
}
