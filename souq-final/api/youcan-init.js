// ═══════════════════════════════════════════════════════════
// api/youcan-init.js — Vercel Serverless Function
// يُنشئ جلسة دفع YouCan Pay ويرجع رابط الدفع
// المفاتيح السرية تبقى هنا فقط — لا تصل للمتصفح أبداً
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || 'https://souq-kom.ma');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── التحقق من المتغيرات البيئية ──
  const SHOP_ID     = process.env.YOUCAN_SHOP_ID;
  const PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;
  const SITE_URL    = process.env.SITE_URL || 'https://souq-kom.ma';

  if (!SHOP_ID || !PRIVATE_KEY) {
    console.error('Missing YouCan environment variables');
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  // ── التحقق من المدخلات ──
  const { amount, orderId, customerName, customerEmail, customerPhone } = req.body || {};

  if (!amount || !orderId) {
    return res.status(400).json({ error: 'المبلغ ورقم الطلب مطلوبان' });
  }
  if (isNaN(amount) || Number(amount) <= 0 || Number(amount) > 500000) {
    return res.status(400).json({ error: 'مبلغ غير صالح' });
  }
  // رقم الطلب: حروف وأرقام وشرطة فقط
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(orderId))) {
    return res.status(400).json({ error: 'رقم طلب غير صالح' });
  }

  // ── تحضير بيانات YouCan ──
  // YouCan يريد المبلغ بالسنتيم (× 100)
  const amountInCentimes = Math.round(Number(amount) * 100);

  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

  try {
    const response = await fetch('https://youcan.shop/api/sell/v1/payments/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${PRIVATE_KEY}`,
        'X-Shop-Id': SHOP_ID,
      },
      body: JSON.stringify({
        amount:      amountInCentimes,
        currency:    'MAD',
        order_id:    String(orderId),
        customer_ip: clientIp,
        success_url: `${SITE_URL}/payment-success.html?order=${orderId}`,
        error_url:   `${SITE_URL}/payment-failed.html?order=${orderId}`,
        webhook_url: `${SITE_URL}/api/youcan-webhook`,
        customer: {
          name:  (customerName  || 'Client').slice(0, 100),
          email: (customerEmail || '').slice(0, 254),
          phone: (customerPhone || '').replace(/[^\d+]/g, '').slice(0, 20),
        },
        metadata: {
          source: 'souq-kom',
          order_id: String(orderId),
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('YouCan API Error:', data);
      return res.status(502).json({
        error: 'فشل الاتصال ببوابة الدفع — حاول مرة أخرى'
      });
    }

    // إرجاع رابط الدفع للواجهة الأمامية فقط
    return res.status(200).json({
      payment_url: data.payment_url,
      token: data.token,
      order_id: orderId,
    });

  } catch (err) {
    console.error('YouCan Init Exception:', err.message);
    return res.status(500).json({ error: 'خطأ داخلي — يرجى المحاولة لاحقاً' });
  }
}
