/**
 * Netlify Function: submit-grievance.js
 * TVK Thiruverumbur · மக்கள் குறைகள் மையம்
 *
 * Receives JSON (text fields + base64 file),
 * generates PDF receipt, emails everything to tvkthiruverumbur@gmail.com
 *
 * package.json dependencies:
 *   nodemailer  ^6.9.13
 *   pdfkit      ^0.15.0
 *
 * Netlify env vars:
 *   GMAIL_USER      tvkthiruverumbur@gmail.com
 *   GMAIL_APP_PASS  (16-char Gmail App Password)
 */

const nodemailer  = require('nodemailer');
const PDFDocument = require('pdfkit');

/* ─────────────────────────────────────────
   Generate PDF receipt — pure in-memory
───────────────────────────────────────── */
function generatePDF(d, complaintId) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    const C = '#7B0012', G = '#C8960C', GR = '#444444';
    const W = doc.page.width;

    /* Header */
    doc.rect(0, 0, W, 86).fill(C);
    doc.fillColor('#FFF').fontSize(20).font('Helvetica-Bold')
       .text('TVK Grievance Portal', 50, 18, { align:'center', width: W-100 });
    doc.fontSize(10).font('Helvetica')
       .text('Thiruverumbur Constituency  |  tvkthiruverumbur@gmail.com', 50, 48, { align:'center', width: W-100 });
    doc.rect(0, 86, W, 4).fill(G);

    /* Complaint ID */
    doc.moveDown(2.2);
    doc.fillColor(C).fontSize(16).font('Helvetica-Bold')
       .text(`Complaint ID: ${complaintId}`, { align:'center' });
    doc.fillColor(GR).fontSize(9).font('Helvetica').moveDown(0.3)
       .text(`Submitted: ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST`, { align:'center' });

    const hr = () => {
      doc.moveDown(0.7)
         .moveTo(50, doc.y).lineTo(W-50, doc.y)
         .strokeColor('#DDDDDD').lineWidth(1).stroke();
      doc.moveDown(0.7);
    };
    const row = (lbl, val) => {
      if (!val || val === 'undefined' || val === '') return;
      doc.fillColor(GR).fontSize(8.5).font('Helvetica-Bold').text(lbl.toUpperCase());
      doc.fillColor('#111').fontSize(11).font('Helvetica').text(String(val));
      doc.moveDown(0.5);
    };

    /* Personal */
    hr();
    doc.fillColor(C).fontSize(12).font('Helvetica-Bold').text('PERSONAL DETAILS');
    doc.moveDown(0.6);
    row('Name / பெயர்',       d.name);
    row('Phone / தொலைபேசி', d.phone);
    row('Address / முகவரி',  d.address);
    row('Local Body',          d.ward_village);

    /* Complaint */
    hr();
    doc.fillColor(C).fontSize(12).font('Helvetica-Bold').text('COMPLAINT DETAILS');
    doc.moveDown(0.6);
    row('Category / வகை',       d.category);
    row('Subject / தலைப்பு',   d.subject);
    row('Priority / முன்னுரிமை', d.priority);
    row('Description / விவரம்', d.description);

    /* Document */
    hr();
    doc.fillColor(C).fontSize(12).font('Helvetica-Bold').text('SUPPORTING DOCUMENT');
    doc.moveDown(0.6);
    doc.fillColor('#111').fontSize(11).font('Helvetica')
       .text(d.file_data ? `✓ ${d.file_name} — see attachment` : '✗ No document provided');

    /* Footer */
    const fy = doc.page.height - 55;
    doc.rect(0, fy, W, 55).fill(C);
    doc.fillColor('#FFF').fontSize(9).font('Helvetica')
       .text('© 2026 தமிழக வெற்றிக் கழகம், திருவெறும்பூர்  |  +91 99942 04215', 50, fy+10, { align:'center', width:W-100 });
    doc.fillColor(G).fontSize(8)
       .text('Auto-generated receipt — keep Complaint ID for reference.', 50, fy+30, { align:'center', width:W-100 });

    doc.end();
  });
}

/* ─────────────────────────────────────────
   Main handler
───────────────────────────────────────── */
exports.handler = async (event) => {

  /* CORS preflight */
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    /* 1. Parse JSON body */
    const d = JSON.parse(event.body || '{}');
    console.log('Received fields:', Object.keys(d).filter(k => k !== 'file_data'));

    const complaintId = d.complaint_id || `TVK-${Date.now()}`;

    /* 2. Check env vars */
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_PASS = process.env.GMAIL_APP_PASS;
    if (!GMAIL_USER || !GMAIL_PASS) {
      throw new Error('Missing GMAIL_USER or GMAIL_APP_PASS environment variables');
    }

    /* 3. Generate PDF */
    const pdfBuffer = await generatePDF(d, complaintId);

    /* 4. Build attachments */
    const attachments = [{
      filename:    `${complaintId}-receipt.pdf`,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }];

    if (d.file_data && d.file_name) {
      attachments.push({
        filename:    `${complaintId}-${d.file_name}`,
        content:     Buffer.from(d.file_data, 'base64'),
        contentType: d.file_type || 'application/octet-stream',
      });
      console.log(`File attached: ${d.file_name} (${d.file_data.length} base64 chars)`);
    }

    /* 5. Send email */
    const transporter = nodemailer.createTransport({
      host:   'smtp.gmail.com',
      port:   465,
      secure: true,
      auth:   { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.verify();
    console.log('SMTP connection verified');

    const priEmoji = { 'சாதாரண':'🟢','Normal':'🟢','அவசரம்':'🟡','Urgent':'🟡','மிக அவசரம்':'🔴','Critical':'🔴' };
    const pri = (priEmoji[d.priority] || '🟢') + ' ' + (d.priority || 'Normal');

    await transporter.sendMail({
      from:    `"TVK Grievance Portal" <${GMAIL_USER}>`,
      to:      'tvkthiruverumbur@gmail.com',
      subject: `[${complaintId}] ${d.subject || 'New Complaint'} — ${d.name || 'Unknown'} | ${pri}`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<div style="max-width:620px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.12);">
  <div style="background:#7B0012;padding:24px;text-align:center;">
    <h2 style="color:#F5C518;margin:0;font-size:22px;">TVK Grievance Portal</h2>
    <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:12px;">திருவெறும்பூர் தொகுதி மக்கள் குறைகள் மையம்</p>
  </div>
  <div style="padding:24px;">
    <div style="background:#7B0012;color:#F5C518;padding:10px 20px;border-radius:8px;font-size:18px;font-weight:bold;display:inline-block;margin-bottom:20px;">${complaintId}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#FFF8EC;">
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;width:38%;border:1px solid #e8d9b0;">பெயர் / Name</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${d.name || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">தொலைபேசி / Phone</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${d.phone || '—'}</td>
      </tr>
      <tr style="background:#FFF8EC;">
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">முகவரி / Address</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${(d.address||'—').replace(/\n/g,'<br>')}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">Local Body</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${d.ward_village || '—'}</td>
      </tr>
      <tr style="background:#FFF8EC;">
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">புகார் வகை / Category</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${d.category || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">தலைப்பு / Subject</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${d.subject || '—'}</td>
      </tr>
      <tr style="background:#FFF8EC;">
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">முன்னுரிமை / Priority</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${pri}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">விவரம் / Description</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${(d.description||'—').replace(/\n/g,'<br>')}</td>
      </tr>
      <tr style="background:#FFF8EC;">
        <td style="padding:10px 14px;font-weight:bold;color:#7B0012;border:1px solid #e8d9b0;">ஆதார ஆவணம் / Document</td>
        <td style="padding:10px 14px;border:1px solid #e8d9b0;">${attachments.length > 1 ? '✅ Attached' : '❌ Not provided'}</td>
      </tr>
    </table>
    <p style="font-size:11px;color:#999;margin-top:16px;">📎 PDF receipt${attachments.length>1?' and uploaded document are':' is'} attached.</p>
  </div>
  <div style="background:#7B0012;padding:14px;text-align:center;">
    <p style="color:rgba(255,255,255,.6);font-size:11px;margin:0;">© 2026 தமிழக வெற்றிக் கழகம், திருவெறும்பூர் &nbsp;|&nbsp; +91 99942 04215</p>
  </div>
</div>
</body></html>`,
      attachments,
    });

    console.log(`✅ Email sent for ${complaintId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, complaint_id: complaintId }),
    };

  } catch (err) {
    console.error('❌ Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
