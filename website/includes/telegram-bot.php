<?php
/**
 * معالج أوامر تيليجرام للأدمن — fb Bablushr F
 * يعمل عبر Webhook: Telegram → موقعك (وارد) ثم رد sendMessage (صادر).
 */

function fbbf_telegram_is_admin_chat($chatId): bool {
    $admin = trim((string)(fbbf_config()['telegram_chat_id'] ?? ''));
    if ($admin === '') return false;
    return (string)$chatId === (string)$admin;
}

function fbbf_telegram_help_text(): string {
    return "🤖 <b>لوحة تحكم fb Bablushr F</b>\n\n"
        . "<b>أوامر:</b>\n"
        . "/stats — إحصائيات سريعة\n"
        . "/users — آخر 8 مستخدمين\n"
        . "/pending — طلبات دفع معلّقة\n"
        . "/activate إيميل [monthly|quarterly|yearly]\n"
        . "/trial إيميل — تجديد تجربة\n"
        . "/block إيميل — حظر\n"
        . "/unblock إيميل — فك حظر\n"
        . "/ext on|off — تشغيل/إيقاف الإضافة عالميًا\n"
        . "/broadcast نص الرسالة — إشعار لكل المستخدمين\n"
        . "/help — هذه القائمة\n\n"
        . "مثال:\n<code>/activate user@gmail.com monthly</code>";
}

function fbbf_telegram_process_command(string $text, $chatId): string {
    $text = trim($text);
    if ($text === '' || $text[0] !== '/') {
        return "أرسل /help لعرض الأوامر.";
    }
    // strip @botname
    $text = preg_replace('/^\\/([a-zA-Z_]+)@[\\w]+/', '/$1', $text) ?? $text;
    $parts = preg_split('/\\s+/', $text, 3);
    $cmd = strtolower($parts[0] ?? '');
    $arg1 = $parts[1] ?? '';
    $arg2 = $parts[2] ?? '';

    switch ($cmd) {
        case '/start':
        case '/help':
            return fbbf_telegram_help_text();

        case '/stats':
            $s = fbbf_admin_stats_snapshot();
            return "📊 <b>إحصائيات</b>\n"
                . "الكل: {$s['all']}\nنشط: {$s['active']} · تجربة: {$s['trial']}\n"
                . "منتهي: {$s['expired']} · محظور: {$s['blocked']}\n"
                . "نشط اليوم: {$s['active_today']}\n"
                . "دفع معلّق: {$s['pending_payments']}\n"
                . "الإضافة: " . ($s['ext_on'] ? '✅ شغّالة' : '⏸ متوقفة');

        case '/users':
            $users = array_slice(array_reverse(fbbf_users()), 0, 8);
            if (!$users) return 'لا يوجد مستخدمون.';
            $lines = ["👥 <b>آخر المستخدمين</b>"];
            foreach ($users as $u) {
                $em = fbbf_h((string)($u['email'] ?? ''));
                $st = fbbf_h((string)($u['status_label'] ?? $u['status'] ?? ''));
                $via = fbbf_h((string)($u['registered_via'] ?? $u['auth_provider'] ?? '—'));
                $lines[] = "• {$em}\n  {$st} · {$via}";
            }
            return implode("\n", $lines);

        case '/pending':
            $payments = fbbf_payments();
            $pending = array_values(array_filter($payments, static fn($p) => ($p['status'] ?? '') === 'pending'));
            if (!$pending) return '✅ لا طلبات دفع معلّقة.';
            $lines = ["💳 <b>طلبات معلّقة (" . count($pending) . ")</b>"];
            foreach (array_slice(array_reverse($pending), 0, 10) as $p) {
                $em = fbbf_h((string)($p['email'] ?? ''));
                $plan = fbbf_h((string)($p['plan_key'] ?? 'monthly'));
                $id = fbbf_h((string)($p['id'] ?? ''));
                $lines[] = "• {$em} — {$plan}\n  فعّل: <code>/activate {$em} {$plan}</code>";
            }
            return implode("\n", $lines);

        case '/activate':
            $email = fbbf_normalize_email($arg1);
            $plan = $arg2 !== '' ? strtolower(trim(explode(' ', $arg2)[0])) : 'monthly';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return 'صيغة: /activate email@x.com monthly';
            $res = fbbf_admin_apply_plan_to_email($email, $plan);
            if (empty($res['ok'])) return '❌ ' . ($res['error'] ?? 'فشل');
            // mark matching pending payments approved
            $payments = fbbf_payments();
            $changed = false;
            foreach ($payments as &$pp) {
                if (($pp['status'] ?? '') === 'pending' && fbbf_normalize_email((string)($pp['email'] ?? '')) === $email) {
                    $pp['status'] = 'approved';
                    $pp['approved_at'] = fbbf_now();
                    $changed = true;
                }
            }
            unset($pp);
            if ($changed) fbbf_save_payments($payments);
            return '✅ تم تفعيل ' . fbbf_h($email) . ' — ' . fbbf_h((string)$res['plan']);

        case '/trial':
            $email = fbbf_normalize_email($arg1);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return 'صيغة: /trial email@x.com';
            $res = fbbf_admin_renew_trial_email($email);
            return empty($res['ok']) ? ('❌ ' . ($res['error'] ?? '')) : ('✅ تجربة جديدة لـ ' . fbbf_h($email));

        case '/block':
            $email = fbbf_normalize_email($arg1);
            $res = fbbf_admin_set_block($email, true);
            return empty($res['ok']) ? ('❌ ' . ($res['error'] ?? '')) : ('🔒 تم حظر ' . fbbf_h($email));

        case '/unblock':
            $email = fbbf_normalize_email($arg1);
            $res = fbbf_admin_set_block($email, false);
            return empty($res['ok']) ? ('❌ ' . ($res['error'] ?? '')) : ('🔓 تم فك حظر ' . fbbf_h($email));

        case '/ext':
            $on = strtolower($arg1);
            if (!in_array($on, ['on', 'off', '1', '0'], true)) return 'صيغة: /ext on أو /ext off';
            $enable = in_array($on, ['on', '1'], true);
            fbbf_set_extension_globally_enabled($enable);
            return $enable ? '✅ تم تشغيل الإضافة عالميًا' : '⏸ تم إيقاف الإضافة عالميًا — لن تعمل عند المستخدمين حتى إعادة التشغيل';

        case '/broadcast':
            $body = trim($arg1 . ($arg2 !== '' ? ' ' . $arg2 : ''));
            // if command was /broadcast text with spaces, reparse
            if (preg_match('/^\\/broadcast\\s+(.+)$/s', $text, $m)) {
                $body = trim($m[1]);
            }
            if ($body === '') return 'صيغة: /broadcast نص الإشعار';
            $ann = [
                'id' => 'tg_' . bin2hex(random_bytes(4)),
                'title' => 'رسالة من الإدارة',
                'body' => $body,
                'type' => 'info',
                'active' => true,
                'created_at' => fbbf_now(),
                'seen_by' => [],
                'email_sent' => 0,
                'email_failed' => 0,
                'source' => 'telegram',
            ];
            $list = function_exists('fbbf_announcements') ? fbbf_announcements() : [];
            array_unshift($list, $ann);
            if (function_exists('fbbf_save_announcements')) {
                fbbf_save_announcements($list);
            } else {
                fbbf_write_json(FBBF_ROOT . '/data/announcements.json', $list);
            }
            return '📢 تم نشر إشعار للمستخدمين (يظهر في الإضافة/الحساب):\n' . fbbf_h(mb_substr($body, 0, 200));

        default:
            return "أمر غير معروف. أرسل /help";
    }
}

function fbbf_telegram_handle_update(array $update): void {
    $msg = $update['message'] ?? $update['edited_message'] ?? null;
    $cb = $update['callback_query'] ?? null;

    if ($cb) {
        $chatId = $cb['message']['chat']['id'] ?? null;
        $data = (string)($cb['data'] ?? '');
        $qid = (string)($cb['id'] ?? '');
        if ($chatId === null || !fbbf_telegram_is_admin_chat($chatId)) {
            fbbf_telegram_api((string)(fbbf_config()['telegram_bot_token'] ?? ''), 'answerCallbackQuery', [
                'callback_query_id' => $qid,
                'text' => 'غير مصرح',
                'show_alert' => '1',
            ]);
            return;
        }
        // callback: act|email|plan
        $reply = 'تم';
        if (preg_match('/^act\\|([^|]+)\\|([a-z]+)$/', $data, $m)) {
            $res = fbbf_admin_apply_plan_to_email($m[1], $m[2]);
            $reply = !empty($res['ok']) ? 'تم التفعيل' : ($res['error'] ?? 'فشل');
        }
        $token = fbbf_normalize_telegram_token((string)(fbbf_config()['telegram_bot_token'] ?? ''));
        fbbf_telegram_api($token, 'answerCallbackQuery', ['callback_query_id' => $qid, 'text' => $reply, 'show_alert' => '1']);
        fbbf_send_telegram('↩️ ' . $reply, null, (string)$chatId);
        return;
    }

    if (!$msg) return;
    $chatId = $msg['chat']['id'] ?? null;
    $text = (string)($msg['text'] ?? '');
    if ($chatId === null) return;

    if (!fbbf_telegram_is_admin_chat($chatId)) {
        // غير الأدمن: رسالة قصيرة فقط
        fbbf_send_telegram(
            "مرحبًا 👋\nهذا بوت إشعارات إدارة fb Bablushr F.\nللدعم تواصل عبر واتساب أو الموقع:\nhttps://faset.xo.je",
            null,
            (string)$chatId
        );
        return;
    }

    $reply = fbbf_telegram_process_command($text, $chatId);
    fbbf_send_telegram($reply, null, (string)$chatId);
}
