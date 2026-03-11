// ═══════════════════════════════════════════════════════════
// api/youcan-webhook.js — Vercel Serverless Function
// يستقبل إشعارات YouCan عند نجاح/فشل الدفع
// هذا الملف هو قلب النظام — يُحدّث قاعدة البيانات
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// مفتاح السيرفر (service_role) — يتجاوز RLS — استخدمه بحذر
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {

  // YouCan يُرسل POST فقط
  if (req.method !== 'POST') return res.status(405).end();

  const PRIVATE_KEY = process.env.YOUCAN_PRIVATE_KEY;

  // ── التحقق من توقيع YouCan (أمان إلزامي) ──
  // بدون هذا التحقق أي شخص يمكنه تزوير إشعار "تم الدفع"
  const signature = req.headers['x-youcan-signature'] || '';
  const rawBody   = JSON.stringify(req.body);

  const expectedSig = crypto
    .createHmac('sha256', PRIVATE_KEY)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSig, 'utf8')
  )) {
    console.error('⚠️ Invalid YouCan signature — possible fraud attempt');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── قراءة بيانات الإشعار ──
  const { event, payload } = req.body || {};

  if (!event || !payload) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const {
    order_id: orderId,
    amount,        // بالسنتيم
    status,
    transaction_id,
    payment_method,
  } = payload;

  console.log(`YouCan Webhook: ${event} | Order: ${orderId} | Status: ${status}`);

  try {

    // ══════════════════════════════════
    // 1. الدفع نجح
    // ══════════════════════════════════
    if (event === 'payment.success' || status === 'paid') {

      // تحديث حالة الطلب
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .update({
          status:         'paid',
          payment_method: payment_method || 'YouCan Pay',
          payment_ref:    transaction_id || null,
          paid_at:        new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })
        .eq('id', orderId)
        .select('seller_id, buyer_id, total, items')
        .single();

      if (orderErr) {
        console.error('Supabase update error:', orderErr);
        return res.status(500).json({ error: 'DB update failed' });
      }

      // إشعار البائع
      if (order?.seller_id) {
        await supabase.from('notifications').insert({
          user_id: order.seller_id,
          type:    'order_paid',
          title:   '💰 تم استلام دفعة جديدة!',
          body:    `طلب رقم ${orderId.slice(0,8)} — ${((amount||0)/100).toFixed(2)} درهم`,
        });
      }

      // تحديث رصيد البائع (بعد خصم العمولة 10%)
      if (order?.seller_id && order?.total) {
        const commission = 0.10;
        const sellerEarning = order.total * (1 - commission);

        const { data: wallet } = await supabase
          .from('profiles')
          .select('wallet_balance')
          .eq('id', order.seller_id)
          .single();

        const currentBalance = wallet?.wallet_balance || 0;

        await supabase
          .from('profiles')
          .update({ wallet_balance: currentBalance + sellerEarning })
          .eq('id', order.seller_id);
      }

      // سجل Audit Log
      await supabase.from('audit_log').insert({
        action:      'PAYMENT_SUCCESS',
        entity_type: 'orders',
        entity_id:   orderId,
        new_data:    { status: 'paid', amount, transaction_id },
        meta:        { source: 'youcan_webhook', event },
      });

      return res.status(200).json({ received: true, status: 'paid' });
    }

    // ══════════════════════════════════
    // 2. الدفع فشل
    // ══════════════════════════════════
    if (event === 'payment.failed' || status === 'failed') {

      await supabase
        .from('orders')
        .update({
          status:     'payment_failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      // إشعار المشتري
      const { data: order } = await supabase
        .from('orders')
        .select('buyer_id')
        .eq('id', orderId)
        .single();

      if (order?.buyer_id) {
        await supabase.from('notifications').insert({
          user_id: order.buyer_id,
          type:    'payment_failed',
          title:   '❌ فشل الدفع',
          body:    'لم يتم الدفع — يرجى المحاولة مرة أخرى أو اختيار طريقة دفع مختلفة',
        });
      }

      await supabase.from('audit_log').insert({
        action:      'PAYMENT_FAILED',
        entity_type: 'orders',
        entity_id:   orderId,
        meta:        { source: 'youcan_webhook', event, status },
      });

      return res.status(200).json({ received: true, status: 'failed' });
    }

    // ══════════════════════════════════
    // 3. أحداث أخرى (refund, dispute...)
    // ══════════════════════════════════
    if (event === 'payment.refunded') {
      await supabase
        .from('orders')
        .update({ status: 'refunded', updated_at: new Date().toISOString() })
        .eq('id', orderId);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── إعداد مهم: Vercel يحتاج raw body للتحقق من التوقيع ──
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100kb',
    },
  },
};
