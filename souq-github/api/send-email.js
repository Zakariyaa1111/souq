// api/send-email.js — إشعارات البريد عبر Resend
// Env vars needed: RESEND_API_KEY, SITE_URL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, to, data } = req.body || {};
  if (!type || !to) return res.status(400).json({ error: 'Missing fields' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SITE_URL   = process.env.SITE_URL || 'https://soouq.vercel.app';

  if (!RESEND_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  const templates = {
    // تأكيد تسجيل بائع جديد
    seller_welcome: {
      subject: '🎉 مرحباً في Souq-Kom — حسابك جاهز!',
      html: `
        <div dir="rtl" style="font-family:Cairo,sans-serif;max-width:500px;margin:0 auto;background:#060912;color:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1246f0,#0088ff);padding:32px 24px;text-align:center">
            <h1 style="font-size:2rem;font-weight:900;margin:0;letter-spacing:2px">SOOUQ</h1>
            <p style="opacity:.8;margin:8px 0 0;font-size:.9rem">السوق الإلكتروني المغربي</p>
          </div>
          <div style="padding:32px 24px">
            <h2 style="font-size:1.2rem;margin-bottom:12px">مرحباً ${data?.name || ''} 👋</h2>
            <p style="color:rgba(255,255,255,.7);line-height:1.7;margin-bottom:24px">
              تم إنشاء حسابك بنجاح. يمكنك الآن البدء في نشر منتجاتك وبيعها.
            </p>
            <a href="${SITE_URL}/seller.html" style="display:block;text-align:center;padding:14px;background:linear-gradient(135deg,#1246f0,#0088ff);color:#fff;text-decoration:none;border-radius:12px;font-weight:800;font-size:.95rem">
              ابدأ البيع الآن →
            </a>
          </div>
          <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,.08);text-align:center;color:rgba(255,255,255,.3);font-size:.72rem">
            Souq-Kom · محمي بالقانون المغربي 31.08 و09.08
          </div>
        </div>`
    },

    // إشعار طلب جديد للبائع
    new_order: {
      subject: '🛍️ طلب جديد على منتجك في Souq-Kom',
      html: `
        <div dir="rtl" style="font-family:Cairo,sans-serif;max-width:500px;margin:0 auto;background:#060912;color:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#059669,#10b981);padding:24px;text-align:center">
            <div style="font-size:2.5rem">🛍️</div>
            <h2 style="margin:8px 0 0;font-size:1.1rem">طلب جديد!</h2>
          </div>
          <div style="padding:28px 24px">
            <p style="color:rgba(255,255,255,.7);margin-bottom:20px">لديك طلب جديد على منتج <strong style="color:#fff">${data?.product_name || ''}</strong></p>
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:24px">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                <span style="color:rgba(255,255,255,.5);font-size:.82rem">المبلغ</span>
                <strong style="color:#10b981">${data?.amount || ''} DH</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:rgba(255,255,255,.5);font-size:.82rem">رقم الطلب</span>
                <span style="font-size:.82rem">#${data?.order_id || ''}</span>
              </div>
            </div>
            <a href="${SITE_URL}/seller.html" style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#1246f0,#0088ff);color:#fff;text-decoration:none;border-radius:12px;font-weight:800">
              عرض الطلب →
            </a>
          </div>
        </div>`
    },

    // تأكيد شراء للمشتري
    order_confirmed: {
      subject: '✅ تم تأكيد طلبك في Souq-Kom',
      html: `
        <div dir="rtl" style="font-family:Cairo,sans-serif;max-width:500px;margin:0 auto;background:#060912;color:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#1246f0,#0088ff);padding:24px;text-align:center">
            <div style="font-size:2.5rem">✅</div>
            <h2 style="margin:8px 0 0">تم تأكيد طلبك!</h2>
          </div>
          <div style="padding:28px 24px">
            <p style="color:rgba(255,255,255,.7);margin-bottom:20px">
              شكراً لك! تم استلام طلبك بنجاح وسيتواصل معك البائع قريباً.
            </p>
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:24px">
              <div style="margin-bottom:8px;font-weight:700">${data?.product_name || ''}</div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:rgba(255,255,255,.5);font-size:.82rem">المبلغ المدفوع</span>
                <strong style="color:#1246f0">${data?.amount || ''} DH</strong>
              </div>
            </div>
          </div>
        </div>`
    },

    // إشعار رسالة جديدة
    new_message: {
      subject: '💬 رسالة جديدة في Souq-Kom',
      html: `
        <div dir="rtl" style="font-family:Cairo,sans-serif;max-width:500px;margin:0 auto;background:#060912;color:#fff;border-radius:16px;overflow:hidden">
          <div style="padding:28px 24px">
            <h2 style="margin-bottom:12px">💬 رسالة جديدة</h2>
            <p style="color:rgba(255,255,255,.7);margin-bottom:20px">لديك رسالة جديدة من <strong style="color:#fff">${data?.sender || ''}</strong></p>
            <div style="background:rgba(255,255,255,.04);border-right:3px solid #1246f0;padding:14px 16px;border-radius:8px;margin-bottom:24px;color:rgba(255,255,255,.7);font-style:italic">
              "${data?.preview || ''}"
            </div>
            <a href="${SITE_URL}/seller.html" style="display:block;text-align:center;padding:13px;background:linear-gradient(135deg,#1246f0,#0088ff);color:#fff;text-decoration:none;border-radius:12px;font-weight:800">
              رد على الرسالة →
            </a>
          </div>
        </div>`
    }
  };

  const tmpl = templates[type];
  if (!tmpl) return res.status(400).json({ error: 'Unknown email type: ' + type });

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'Souq-Kom <onboarding@resend.dev>',
        to:      [to],
        subject: tmpl.subject,
        html:    tmpl.html
      })
    });
    const result = await resp.json();
    if (resp.ok) {
      return res.status(200).json({ success: true, id: result.id });
    } else {
      console.error('Resend error:', result);
      return res.status(500).json({ error: result.message || 'Email failed' });
    }
  } catch (err) {
    console.error('Email send error:', err);
    return res.status(500).json({ error: err.message });
  }
}
