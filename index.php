<?php
require __DIR__ . '/includes/bootstrap.php';
$config       = fbbf_config();
$theme        = $config['site_theme'] ?? 'publisher';
$accentColor  = $config['accent_color'] ?? '#3b82f6';
$navEmail     = function_exists('fbbf_current_user_email') ? fbbf_current_user_email() : '';
$navLogged    = $navEmail !== '';
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="description" content="أقوى أداة نشر تلقائي في جروبات فيسبوك بذكاء اصطناعي. انشر في الخلفية، تجنب الحظر، وادفع بسهولة عبر فودافون كاش. جرب مجاناً لمدة 3 أيام."/>
<meta name="keywords" content="fb bablushr, نشر جروبات فيسبوك, إضافة كروم, kiwi, quetta, spintax, نشر تلقائي"/>
<meta property="og:title" content="fb Bablushr F | محرك النشر الذكي لجروبات فيسبوك"/>
<meta property="og:description" content="انشر في 500+ جروب بضغطة واحدة مع حماية متقدمة وذكاء اصطناعي. اشتراك يبدأ من 99 جنيه عبر فودافون كاش."/>
<meta property="og:image" content="https://faset.xo.je/media/og-image.jpg"/>
<meta property="og:url" content="https://faset.xo.je"/>
<meta property="og:type" content="website"/>
<meta property="og:locale" content="ar_EG"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="fb Bablushr F | محرك النشر الذكي لجروبات فيسبوك"/>
<meta name="twitter:description" content="انشر في 500+ جروب بضغطة واحدة. تجربة مجانية 3 أيام."/>
<meta name="twitter:image" content="https://faset.xo.je/media/og-image.jpg"/>
<meta name="theme-color" content="#0a0e17"/>
<link rel="canonical" href="https://faset.xo.je/"/>
<title>fb Bablushr F | محرك النشر الذكي لجروبات فيسبوك</title>
<link rel="icon" href="https://faset.xo.je/assets/icons/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="https://faset.xo.je/assets/icons/icon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="https://faset.xo.je/assets/icons/icon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="https://faset.xo.je/assets/icons/icon-180.png"/>
<link rel="manifest" href="https://faset.xo.je/site.webmanifest"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="fb Bablushr F"/>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "fb Bablushr F",
  "applicationCategory": "BrowserApplication",
  "operatingSystem": "Chrome, Edge, Brave, Kiwi, Quetta",
  "offers": {
    "@type": "Offer",
    "price": "99",
    "priceCurrency": "EGP",
    "availability": "https://schema.org/InStock"
  },
  "description": "أداة نشر تلقائي في جروبات فيسبوك مع Spintax وذكاء اصطناعي ونشر في الخلفية.",
  "url": "https://faset.xo.je",
  "author": { "@type": "Organization", "name": "fb Bablushr F" },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "120"
  }
}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"/>
<!-- GeoIP tracking — ipinfo.io (free tier, no key needed for basic) -->
<style>
/* ══════════════════════════════════════════════════════════════════
   DESIGN SYSTEM — Verdigris (جرافيت دافئ × تركواز عميق)
   القيم الأساسية ثابتة كخلفية افتراضية، واللون الأساسي (--p1/--p2/--p3
   وما يتبعها) بيتحقن ديناميكيًا تحت حسب اختيار الأدمن — نفس آلية
   admin/index.php بالضبط، عشان يتطابق الموقع العام مع اللوحة فعليًا.
   ══════════════════════════════════════════════════════════════════ */
:root {
  /* هوية FB Publisher X — أزرق كهربائي + بنفسجي نيون (من مواد التسويق) */
  --bg:    #0a0e17;
  --s1:    rgba(10,14,28,0.97);
  --s2:    #121826;
  --s3:    #1a2233;
  --s4:    #243044;
  --b1:    rgba(96,130,180,0.10);
  --b2:    rgba(96,130,180,0.20);
  --b3:    rgba(120,130,160,0.22);
  --t1:    #e6eaf2;
  --t2:    #9aa3b5;
  --t3:    #8b9cb8;
  --p1:    #4a6fa5;
  --p2:    #6b8fc5;
  --p3:    #8b9cb8;
  --pg:    linear-gradient(135deg, #2a3f6a 0%, #3d5a8a 40%, #4a6fa5 100%);
  --pglow: rgba(74,111,165,0.28);
  --gold:  #7eb6d9;
  --gold2: #9aa3b5;
  --goldg: linear-gradient(135deg, #2a3f6a 0%, #3d5a8a 50%, #4a6fa5 100%);
  --ok:    #4ade80;
  --err:   #fb7185;
  --warn:  #fbbf24;
  --font:  'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,sans-serif;
  --r1:8px; --r2:14px; --r3:20px; --r4:28px;
}
<?php
// محرك الثيم الموحّد من الأدمن (site_theme) — ينعكس فورًا على الموقع
if (function_exists('fbbf_active_theme') && function_exists('fbbf_public_theme_payload')) {
    $tp = fbbf_public_theme_payload();
    $v = $tp['vars'] ?? [];
    $bg = $v['--bg'] ?? '#0a0e17';
    $s1 = $v['--s1'] ?? '#121826';
    $s2 = $v['--s2'] ?? '#1a2233';
    $p1 = $v['--p1'] ?? '#4a6fa5';
    $p2 = $v['--p2'] ?? '#6b8fc5';
    $p3 = $v['--p3'] ?? '#8b9cb8';
    $t1 = $v['--t1'] ?? '#e6eaf2';
    $t2 = $v['--t2'] ?? '#9aa3b5';
    $warn = $v['--warn'] ?? '#fbbf24';
    $pg = $v['--pg'] ?? 'linear-gradient(135deg,#2a3f6a,#3d5a8a,#4a6fa5)';
    $glow = $v['--glow'] ?? 'rgba(74,111,165,0.28)';
    $radius = $v['--radius'] ?? '14px';
    echo ":root{";
    echo "--bg:" . $bg . ";--s1:" . $s1 . ";--s2:" . $s2 . ";--s3:" . $s2 . ";";
    echo "--p1:" . $p1 . ";--p2:" . $p2 . ";--p3:" . $p3 . ";";
    echo "--pg:" . $pg . ";--pglow:" . $glow . ";";
    echo "--b1:" . $glow . ";--b2:" . $glow . ";";
    echo "--gold:" . $p2 . ";--gold2:" . $p3 . ";";
    echo "--t1:" . $t1 . ";--t2:" . $t2 . ";--t3:" . $t2 . ";";
    echo "--warn:" . $warn . ";--r2:" . $radius . ";";
    echo "}\n";
}
?>
body.light-mode {
  --bg:    #f4f7ff;
  --s1:    rgba(255,255,255,0.98);
  --s2:    #ffffff;
  --s3:    #eef2ff;
  --s4:    #dde5ff;
  --b1:    rgba(96,130,180,0.10);
  --b2:    rgba(59,130,246,0.22);
  --b3:    rgba(37,99,235,0.35);
  --t1:    #0f172a;
  --t2:    #475569;
  --t3:    #1d4ed8;
  --p1:    #2563eb;
  --p2:    #0d5f58;
  --p3:    #0d5f58;
  --pg:    linear-gradient(135deg, #0d5f58 0%, #0f766e 48%, #2dd4bf 100%);
  --pglow: rgba(20,184,166,0.28);
  --gold:  #0f766e;
  --gold2: #5eead4;
}

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;font-size:16px;}
body{
  font-family:var(--font);
  background:
    radial-gradient(ellipse 65% 38% at 85% 0%,   rgba(59,130,246,0.14), transparent 42%),
    radial-gradient(ellipse 50% 32% at 10% 95%,  rgba(124,92,252,0.10), transparent 40%),
    var(--bg);
  color:var(--t1);
  min-height:100vh;
  transition:background 0.35s, color 0.25s;
  overflow-x:hidden;
}
body.light-mode{
  background:
    radial-gradient(ellipse 55% 28% at 82% 2%,  rgba(45,212,191,0.04), transparent),
    radial-gradient(ellipse 40% 22% at 12% 92%, rgba(20,184,166,0.03), transparent),
    var(--bg);
}

/* Scrollbar */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:var(--s2)}
::-webkit-scrollbar-thumb{background:rgba(45,212,191,0.30);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:rgba(94,214,201,0.55)}

/* ── STICKY NAV ─────────────────────────────────────────────────── */
#siteNav {
  position:sticky;
  top:0;
  z-index:1000;
  background:var(--s1);
  border-bottom:1px solid var(--b2);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  box-shadow:0 2px 24px rgba(0,0,0,0.36);
  transition:background 0.3s, border-color 0.3s;
}
.nav-inner{
  max-width:1100px;
  margin:0 auto;
  padding:0 clamp(14px,4vw,32px);
  height:64px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
}
.nav-logo{display:flex;align-items:center;gap:10px;text-decoration:none;}
.nav-logo-svg{width:40px;height:40px;flex-shrink:0;overflow:visible;}
.nav-brand{display:flex;flex-direction:column;gap:1px;}
.nav-brand-name{font-size:15px;font-weight:900;color:var(--t1);letter-spacing:-0.3px;}
.nav-brand-tag{font-size:9px;font-weight:700;color:var(--p2);text-transform:uppercase;letter-spacing:1.4px;}
.nav-links{display:flex;align-items:center;gap:4px;list-style:none;}
.nav-links a{
  color:var(--t2);
  text-decoration:none;
  font-size:13px;
  font-weight:600;
  padding:6px 12px;
  border-radius:8px;
  transition:color 0.18s, background 0.18s;
}
.nav-links a:hover{color:var(--p3);background:rgba(45,212,191,0.10);}
.nav-right{display:flex;align-items:center;gap:8px;}
.nav-version-chip{
  background:rgba(45,212,191,0.12);
  border:1px solid rgba(94,214,201,0.28);
  color:var(--p3);
  font-size:10px;font-weight:700;
  padding:3px 9px;border-radius:20px;letter-spacing:0.5px;
}
#themeToggleBtn{
  width:36px;height:36px;
  background:rgba(45,212,191,0.10);
  border:1px solid rgba(45,212,191,0.22);
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--p3);
  transition:all 0.25s;
  flex-shrink:0;
}
#themeToggleBtn:hover{background:rgba(45,212,191,0.22);border-color:rgba(94,214,201,0.45);transform:rotate(20deg);}
#themeToggleBtn svg{display:block;pointer-events:none;}
.nav-dl-btn{
  background:var(--pg);
  border:none;color:#fff;
  font-size:12px;font-weight:800;
  padding:8px 16px;
  border-radius:var(--r2);
  cursor:pointer;
  font-family:var(--font);
  text-decoration:none;display:inline-flex;align-items:center;gap:6px;
  box-shadow:0 4px 16px var(--pglow);
  transition:filter 0.2s, transform 0.15s;
  white-space:nowrap;
}
.nav-dl-btn:hover{filter:brightness(1.12);transform:translateY(-1px);}
.hamburger{display:none;flex-direction:column;gap:4px;cursor:pointer;background:none;border:none;padding:4px;}
.hamburger span{display:block;width:22px;height:2px;background:var(--t2);border-radius:2px;transition:all 0.25s;}
@media(max-width:768px){
  .nav-links{display:none;position:absolute;top:64px;right:0;left:0;background:var(--s1);border-bottom:1px solid var(--b2);flex-direction:column;gap:2px;padding:10px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.3);}
  .nav-links.open{display:flex;}
  .nav-links a{padding:10px 14px;}
  .hamburger{display:flex;}
  .nav-version-chip{display:none;}
}

/* ── HERO ────────────────────────────────────────────────────────── */
.hero{
  padding:clamp(60px,12vw,120px) clamp(16px,5vw,40px) clamp(50px,10vw,100px);
  text-align:center;
  position:relative;
  overflow:hidden;
}
.hero::before{
  content:'';
  position:absolute;inset:0;
  background:
    radial-gradient(ellipse 70% 60% at 50% 0%, rgba(45,212,191,0.10), transparent 55%);
  pointer-events:none;
}
.hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(45,212,191,0.12);
  border:1px solid rgba(94,214,201,0.30);
  color:var(--p3);
  font-size:12px;font-weight:700;
  padding:6px 16px;border-radius:24px;
  margin-bottom:24px;letter-spacing:0.5px;
}
.hero-eyebrow .dot{width:7px;height:7px;border-radius:50%;background:var(--p2);animation:blink 1.8s ease infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.hero-h1{
  font-size:clamp(32px,6vw,68px);
  font-weight:900;
  line-height:1.14;
  color:var(--t1);
  letter-spacing:-1.5px;
  margin-bottom:8px;
  position:relative;
}
.hero-h1-accent{
  background:linear-gradient(135deg, #5eead4, #99f6e4 50%, #c0d0ff);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  background-clip:text;
}
.hero-h1-sub{
  font-size:clamp(22px,4vw,44px);
  font-weight:800;
  color:var(--t2);
  letter-spacing:-0.8px;
  margin-bottom:24px;
}
.hero-desc{
  font-size:clamp(14px,2vw,18px);
  color:var(--t2);line-height:1.72;
  max-width:620px;margin:0 auto 36px;
}
.hero-cta-row{
  display:flex;align-items:center;justify-content:center;
  flex-wrap:wrap;gap:14px;margin-bottom:48px;
}
.btn-hero-dl{
  display:inline-flex;align-items:center;gap:10px;
  background:var(--pg);
  border:none;color:#fff;
  font-size:16px;font-weight:900;
  padding:16px 32px;border-radius:var(--r3);
  cursor:pointer;font-family:var(--font);
  box-shadow:0 8px 32px var(--pglow), inset 0 1px 0 rgba(255,255,255,0.18);
  transition:all 0.2s;text-decoration:none;
  position:relative;overflow:hidden;
  letter-spacing:0.3px;
}
.btn-hero-dl::before{
  content:'';
  position:absolute;top:0;left:-100%;width:55%;height:100%;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,0.22),transparent);
  transition:left 0.55s;pointer-events:none;
}
.btn-hero-dl:hover::before{left:150%;}
.btn-hero-dl:hover{transform:translateY(-2px);box-shadow:0 12px 40px var(--pglow);}
.btn-hero-dl:active{transform:scale(0.97);}
.btn-hero-demo{
  display:inline-flex;align-items:center;gap:8px;
  background:transparent;
  border:1.5px solid var(--b2);
  color:var(--t2);
  font-size:14px;font-weight:700;
  padding:14px 24px;border-radius:var(--r3);
  cursor:pointer;font-family:var(--font);
  transition:all 0.2s;text-decoration:none;
}
.btn-hero-demo:hover{border-color:var(--p2);color:var(--p3);background:rgba(45,212,191,0.08);}

/* Stats row */
.hero-stats{
  display:flex;justify-content:center;
  flex-wrap:wrap;gap:clamp(8px,2vw,20px);
  max-width:700px;margin:0 auto;
}
.stat-card{
  display:flex;flex-direction:column;align-items:center;
  background:var(--s2);
  border:1px solid var(--b2);
  border-radius:var(--r3);
  padding:clamp(14px,3vw,22px) clamp(20px,4vw,36px);
  min-width:130px;flex:1;max-width:200px;
  transition:transform 0.2s, box-shadow 0.2s;
}
.stat-card:hover{transform:translateY(-3px);box-shadow:0 8px 28px rgba(45,212,191,0.14);}
.stat-num{font-size:clamp(28px,5vw,42px);font-weight:900;color:var(--p2);font-family:'Cairo',sans-serif;line-height:1;}
.stat-num.gold{background:var(--goldg);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.stat-lbl{font-size:12px;color:var(--t3);margin-top:5px;font-weight:600;text-align:center;}

/* ── SECTION GENERIC ────────────────────────────────────────────── */
section{padding:clamp(60px,9vw,100px) clamp(16px,5vw,40px);}
.section-inner{max-width:1100px;margin:0 auto;}
.section-tag{
  display:inline-flex;align-items:center;gap:7px;
  background:rgba(45,212,191,0.10);
  border:1px solid rgba(94,214,201,0.24);
  color:var(--p3);
  font-size:11px;font-weight:700;
  padding:5px 13px;border-radius:20px;
  margin-bottom:16px;text-transform:uppercase;letter-spacing:0.8px;
}
.section-h2{
  font-size:clamp(24px,4.5vw,42px);
  font-weight:900;color:var(--t1);
  letter-spacing:-0.8px;margin-bottom:14px;
  line-height:1.18;
}
.section-sub{
  font-size:clamp(13px,1.8vw,16px);
  color:var(--t2);line-height:1.7;
  max-width:580px;margin-bottom:clamp(32px,5vw,52px);
}
.text-accent{
  background:linear-gradient(135deg,#5eead4,#99f6e4);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}
.text-gold{
  background:var(--goldg);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
}

/* ── FEATURES SECTION ────────────────────────────────────────────── */
#features{background:linear-gradient(180deg,rgba(45,212,191,0.04),transparent 60%);}
.feats-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
  gap:16px;
}
.feat-card{min-height:210px;
  background:var(--s2);
  border:1px solid var(--b1);
  border-radius:var(--r3);
  padding:clamp(18px,3vw,28px);
  display:flex;flex-direction:column;gap:14px;
  transition:border-color 0.22s, box-shadow 0.22s, transform 0.22s;
  position:relative;overflow:hidden;
}
.feat-card::before{
  content:'';
  position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(94,214,201,0.40),transparent);
  opacity:0;transition:opacity 0.3s;
}
.feat-card:hover{
  border-color:var(--b2);
  box-shadow:0 8px 32px rgba(45,212,191,0.12);
  transform:translateY(-2px);
}
.feat-card:hover::before{opacity:1;}
.feat-card.feat-new{
  border-color:rgba(45,212,191,0.22);
  background:linear-gradient(160deg,rgba(45,212,191,0.07),var(--s2) 60%);
}
.feat-new-badge{
  position:absolute;top:12px;left:12px;
  font-size:9px;font-weight:900;letter-spacing:1px;text-transform:uppercase;
  background:linear-gradient(135deg,#134e4a,#14b8a6,#2dd4bf);
  color:#fff;padding:3px 9px;border-radius:20px;
  box-shadow:0 3px 10px rgba(20,184,166,0.35);
}
.feat-icon{
  width:48px;height:48px;border-radius:14px;
  display:flex;align-items:center;justify-content:center;
  font-size:24px;flex-shrink:0;
}
.fi-indigo{background:rgba(45,212,191,0.14);}
.fi-gold{background:rgba(212,162,48,0.14);}
.fi-teal{background:rgba(34,211,160,0.12);}
.fi-purple{background:rgba(45,212,191,0.12);}
.fi-rose{background:rgba(244,63,94,0.12);}
.fi-sky{background:rgba(14,165,233,0.12);}
.feat-h3{font-size:16px;font-weight:800;color:var(--t1);font-family:'Cairo',sans-serif;line-height:1.3;}
.feat-p{font-size:13px;color:var(--t2);line-height:1.65;}
.feat-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:10px;}
.feat-tag{
  font-size:10px;font-weight:700;
  padding:3px 8px;border-radius:20px;
  background:rgba(45,212,191,0.10);
  border:1px solid rgba(45,212,191,0.18);
  color:var(--p3);
}

/* ── DASHBOARD SECTION ───────────────────────────────────────────── */
#dashboard{
  background:var(--s2);
  border-top:1px solid var(--b1);
  border-bottom:1px solid var(--b1);
}
.dash-layout{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:clamp(24px,5vw,56px);
  align-items:center;
}
@media(max-width:768px){.dash-layout{grid-template-columns:1fr;}}
.dash-img-wrap{
  position:relative;
  border-radius:var(--r4);
  overflow:hidden;
  border:1px solid var(--b2);
  box-shadow:0 16px 48px rgba(0,0,0,0.5);
  aspect-ratio:16/10;
  background:var(--s3);
  display:flex;align-items:center;justify-content:center;
}
.dash-mock{
  width:100%;height:100%;
  display:flex;flex-direction:column;
  gap:0;
  background:linear-gradient(160deg, #0a0f1e, #0e1528);
}
.dash-mock-header{
  height:44px;
  background:rgba(7,10,20,0.98);
  border-bottom:1px solid rgba(45,212,191,0.18);
  display:flex;align-items:center;gap:12px;
  padding:0 16px;flex-shrink:0;
}
.dash-mock-dot{width:9px;height:9px;border-radius:50%;}
.dash-mock-body{flex:1;padding:14px;display:flex;flex-direction:column;gap:10px;}
.dash-mock-bar{
  height:8px;border-radius:4px;
  background:linear-gradient(90deg,rgba(45,212,191,0.7),rgba(20,184,166,0.4));
  animation:shimmer 2s ease infinite;
}
@keyframes shimmer{0%{opacity:0.5}50%{opacity:1}100%{opacity:0.5}}
.dash-mock-row{display:flex;gap:8px;}
.dash-mock-cell{
  height:36px;border-radius:8px;
  background:rgba(45,212,191,0.10);
  border:1px solid rgba(45,212,191,0.14);
  flex:1;
  animation:shimmer 2.4s ease infinite;
}
.dash-mock-cell:nth-child(2){animation-delay:0.3s;}
.dash-mock-cell:nth-child(3){animation-delay:0.6s;}
.dash-features-list{display:flex;flex-direction:column;gap:14px;}
.dash-feat-item{display:flex;align-items:flex-start;gap:14px;}
.dash-feat-check{
  width:32px;height:32px;border-radius:50%;flex-shrink:0;
  background:var(--pg);
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:14px;font-weight:900;
  box-shadow:0 4px 12px var(--pglow);
  margin-top:2px;
}
.dash-feat-title{font-size:15px;font-weight:800;color:var(--t1);margin-bottom:4px;font-family:'Cairo',sans-serif;}
.dash-feat-desc{font-size:13px;color:var(--t2);line-height:1.6;}

/* ── HOW IT WORKS ────────────────────────────────────────────────── */
#how{background:linear-gradient(180deg,rgba(20,184,166,0.04),transparent 60%);}
.steps-timeline{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:0;
  position:relative;
}
.steps-timeline::before{
  content:'';
  position:absolute;
  top:40px;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--b2),var(--p2),var(--b2),transparent);
}
@media(max-width:600px){.steps-timeline{grid-template-columns:1fr;}.steps-timeline::before{display:none;}}
.step-card{
  display:flex;flex-direction:column;align-items:center;
  text-align:center;
  padding:clamp(20px,4vw,36px) clamp(14px,3vw,24px);
  position:relative;
}
.step-num{
  width:80px;height:80px;border-radius:50%;
  background:var(--pg);
  display:flex;align-items:center;justify-content:center;
  font-size:28px;font-weight:900;color:#fff;
  font-family:'Cairo',sans-serif;
  box-shadow:0 6px 24px var(--pglow);
  margin-bottom:18px;
  border:3px solid var(--bg);
  position:relative;z-index:1;
  transition:transform 0.25s, box-shadow 0.25s;
}
.step-card:hover .step-num{transform:scale(1.08);box-shadow:0 10px 32px var(--pglow);}
.step-title{font-size:17px;font-weight:800;color:var(--t1);margin-bottom:8px;font-family:'Cairo',sans-serif;}
.step-desc{font-size:13px;color:var(--t2);line-height:1.65;}

/* ── PRICING ─────────────────────────────────────────────────────── */
#pricing{background:var(--s2);border-top:1px solid var(--b1);border-bottom:1px solid var(--b1);}
.pricing-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:16px;
  align-items:start;
}
.plan-card{
  background:var(--bg);
  border:1px solid var(--b1);
  border-radius:var(--r4);
  padding:clamp(20px,3vw,28px);
  display:flex;flex-direction:column;gap:16px;
  position:relative;
  transition:border-color 0.22s, box-shadow 0.22s, transform 0.22s;
min-height:320px;}
.plan-card:hover{border-color:var(--b2);box-shadow:0 8px 32px rgba(45,212,191,0.12);transform:translateY(-2px);}
.plan-card.featured{
  border-color:rgba(212,162,48,0.55)!important;
  box-shadow:0 0 30px rgba(212,162,48,0.15)!important;
  background:linear-gradient(160deg,rgba(212,162,48,0.06),var(--bg));
}
.plan-card.purple-plan{
  border-color:rgba(45,212,191,0.38)!important;
  background:linear-gradient(160deg,rgba(45,212,191,0.06),var(--bg));
}
.plan-ribbon{
  position:absolute;top:-10px;right:18px;
  font-size:10px;font-weight:800;
  padding:3px 12px;border-radius:20px;
  text-transform:uppercase;letter-spacing:0.6px;
}
.ribbon-gold{background:rgba(212,162,48,0.18);border:1px solid rgba(212,162,48,0.40);color:var(--gold2);}
.ribbon-purple{background:rgba(45,212,191,0.14);border:1px solid rgba(45,212,191,0.35);color:#99f6e4;}
.plan-name{font-size:18px;font-weight:800;color:var(--t1);font-family:'Cairo',sans-serif;}
.plan-price-wrap{display:flex;align-items:baseline;gap:6px;}
.plan-price{font-size:clamp(28px,5vw,40px);font-weight:900;color:var(--t1);font-family:'Cairo',sans-serif;line-height:1;}
.plan-currency{font-size:14px;font-weight:700;color:var(--t2);}
.plan-period{font-size:12px;font-weight:600;color:var(--t3);}
.plan-per-month{font-size:11px;color:var(--ok);font-weight:700;margin-top:-6px;}
.plan-divider{height:1px;background:var(--b1);}
.plan-features-list{list-style:none;display:flex;flex-direction:column;gap:9px;padding:0;flex:1;}
.plan-features-list li{
  display:flex;align-items:flex-start;gap:8px;
  font-size:13px;color:var(--t2);line-height:1.45;
}
.plan-check{color:var(--ok);font-weight:900;flex-shrink:0;margin-top:1px;}
.plan-star{color:var(--gold2);font-weight:900;flex-shrink:0;margin-top:1px;}
.btn-plan{
  width:100%;padding:14px 0;
  border:none;border-radius:var(--r2);
  font-size:14px;font-weight:800;
  cursor:pointer;font-family:var(--font);
  transition:filter 0.2s, transform 0.15s;
  margin-top:auto;
}
.btn-plan-default{background:var(--pg);color:#fff;box-shadow:0 4px 16px var(--pglow);}
.btn-plan-gold{background:var(--goldg);color:#fff;box-shadow:0 4px 16px rgba(212,162,48,0.38);}
.btn-plan-purple{background:linear-gradient(135deg,#134e4a,#14b8a6,#2dd4bf);color:#fff;box-shadow:0 4px 16px rgba(45,212,191,0.35);}
.btn-plan:hover{filter:brightness(1.12);transform:translateY(-1px);}
.pricing-note{text-align:center;font-size:12px;color:var(--t3);margin-top:24px;}

/* ── DOWNLOAD SECTION ────────────────────────────────────────────── */
#download{
  background:
    radial-gradient(ellipse 80% 50% at 50% 50%, rgba(45,212,191,0.08), transparent 55%),
    var(--bg);
  border-top:1px solid var(--b1);
  text-align:center;
}
.dl-badge{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(34,211,160,0.10);
  border:1px solid rgba(34,211,160,0.28);
  color:var(--ok);
  font-size:12px;font-weight:700;
  padding:6px 16px;border-radius:24px;
  margin-bottom:24px;
}
.dl-version{
  font-size:13px;color:var(--t3);margin-bottom:32px;
}
.dl-requirements{
  display:flex;justify-content:center;flex-wrap:wrap;gap:10px;
  margin-bottom:36px;
}
.dl-req{
  display:flex;align-items:center;gap:7px;
  background:var(--s2);border:1px solid var(--b1);
  border-radius:var(--r2);padding:10px 16px;
  font-size:12px;color:var(--t2);font-weight:600;
}
.dl-req-icon{font-size:18px;}

.btn-download-big{
  display:inline-flex;align-items:center;gap:12px;
  background:var(--pg);
  border:none;color:#fff;
  font-size:18px;font-weight:900;
  padding:20px 48px;border-radius:var(--r3);
  cursor:pointer;font-family:var(--font);
  box-shadow:0 10px 40px var(--pglow), inset 0 1px 0 rgba(255,255,255,0.20);
  transition:all 0.22s;text-decoration:none;
  position:relative;overflow:hidden;
  letter-spacing:0.3px;
  margin-bottom:16px;
}
.btn-download-big::before{
  content:'';
  position:absolute;top:0;left:-100%;width:55%;height:100%;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,0.22),transparent);
  transition:left 0.55s;pointer-events:none;
}
.btn-download-big:hover::before{left:150%;}
.btn-download-big:hover{transform:translateY(-3px);box-shadow:0 16px 52px var(--pglow);}
.btn-download-big:active{transform:scale(0.97);}
.dl-fileinfo{font-size:12px;color:var(--t3);margin-bottom:48px;}
.dl-fileinfo a{color:var(--p3);text-decoration:underline;cursor:pointer;}

/* ── INSTALL GUIDE ───────────────────────────────────────────────── */
#install{background:var(--s2);border-top:1px solid var(--b1);}
.install-tabs{
  display:flex;gap:6px;flex-wrap:wrap;
  background:var(--bg);border-radius:var(--r2);padding:4px;
  margin-bottom:28px;
  border:1px solid var(--b1);
}
.install-tab{
  flex:1;min-width:120px;
  padding:10px 12px;border:none;border-radius:var(--r1);
  background:transparent;color:var(--t2);
  font-size:13px;font-weight:700;cursor:pointer;
  font-family:var(--font);
  transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:7px;
}
.install-tab.active{background:var(--pg);color:#fff;box-shadow:0 4px 14px var(--pglow);}
.install-tab:hover:not(.active){background:rgba(45,212,191,0.10);color:var(--p3);}
.install-panel{display:none;}
.install-panel.active{display:block;}
.install-steps-list{display:flex;flex-direction:column;gap:14px;}
.install-step{
  display:flex;align-items:flex-start;gap:14px;
  background:var(--bg);border:1px solid var(--b1);
  border-radius:var(--r2);padding:16px 18px;
  transition:border-color 0.2s;
}
.install-step:hover{border-color:var(--b2);}
.install-step-num{
  width:28px;height:28px;border-radius:50%;flex-shrink:0;
  background:var(--pg);color:#fff;
  font-size:13px;font-weight:900;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 3px 10px var(--pglow);font-family:'Cairo',sans-serif;
  margin-top:1px;
}
.install-step-body{}
.install-step-title{font-size:14px;font-weight:800;color:var(--t1);margin-bottom:4px;font-family:'Cairo',sans-serif;}
.install-step-desc{font-size:13px;color:var(--t2);line-height:1.6;}
.install-step-desc code{
  background:rgba(45,212,191,0.14);
  border:1px solid rgba(45,212,191,0.22);
  color:var(--p3);border-radius:5px;
  padding:2px 7px;font-size:12px;font-family:monospace;
}
.install-tip{
  margin-top:20px;
  background:rgba(34,211,160,0.07);
  border:1px solid rgba(34,211,160,0.22);
  border-radius:var(--r2);padding:14px 18px;
  font-size:13px;color:var(--ok);
  display:flex;align-items:flex-start;gap:10px;
}

/* ── FAQ ─────────────────────────────────────────────────────────── */
#faq{}
.faq-list{display:flex;flex-direction:column;gap:10px;max-width:780px;margin:0 auto;}
.faq-item{
  background:var(--s2);border:1px solid var(--b1);
  border-radius:var(--r2);overflow:hidden;
  transition:border-color 0.2s;
}
.faq-item:hover{border-color:var(--b2);}
.faq-q{
  width:100%;padding:18px 20px;
  background:none;border:none;
  color:var(--t1);font-size:15px;font-weight:700;
  cursor:pointer;font-family:var(--font);
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  text-align:right;
}
.faq-arrow{font-size:18px;color:var(--p2);transition:transform 0.25s;flex-shrink:0;}
.faq-item.open .faq-arrow{transform:rotate(180deg);}
.faq-a{
  max-height:0;overflow:hidden;
  transition:max-height 0.35s ease, padding 0.25s;
  font-size:13px;color:var(--t2);line-height:1.7;
  padding:0 20px;
}
.faq-item.open .faq-a{max-height:300px;padding:0 20px 18px;}

/* ── FINAL CTA ───────────────────────────────────────────────────── */
#final-cta{
  background:
    radial-gradient(ellipse 90% 60% at 50% 100%, rgba(45,212,191,0.12), transparent 55%),
    var(--bg);
  text-align:center;
  border-top:1px solid var(--b1);
}
.final-cta-inner{max-width:620px;margin:0 auto;}
.final-h2{font-size:clamp(26px,5vw,48px);font-weight:900;color:var(--t1);letter-spacing:-1px;margin-bottom:14px;line-height:1.18;}
.final-sub{font-size:15px;color:var(--t2);margin-bottom:36px;line-height:1.65;}
.final-trust{
  display:flex;justify-content:center;flex-wrap:wrap;gap:20px;
  margin-top:36px;font-size:12px;color:var(--t3);
}
.final-trust span{display:flex;align-items:center;gap:6px;}

/* ── FOOTER ──────────────────────────────────────────────────────── */
footer{
  background:var(--s2);
  border-top:1px solid var(--b1);
  padding:clamp(28px,5vw,48px) clamp(16px,5vw,40px);
}
.footer-inner{
  max-width:1100px;margin:0 auto;
  display:grid;grid-template-columns:1fr 1fr 1fr;
  gap:clamp(20px,4vw,40px);
}
@media(max-width:640px){.footer-inner{grid-template-columns:1fr;}}
.footer-brand-name{font-size:16px;font-weight:900;color:var(--t1);margin-bottom:8px;}
.footer-brand-desc{font-size:12px;color:var(--t3);line-height:1.6;}
.footer-col-title{font-size:13px;font-weight:800;color:var(--t1);margin-bottom:12px;}
.footer-links{list-style:none;display:flex;flex-direction:column;gap:7px;}
.footer-links a{font-size:12px;color:var(--t3);text-decoration:none;transition:color 0.2s;}
.footer-links a:hover{color:var(--p3);}
.footer-bottom{
  max-width:1100px;margin:28px auto 0;
  padding-top:20px;border-top:1px solid var(--b1);
  display:flex;align-items:center;justify-content:space-between;
  flex-wrap:wrap;gap:12px;
  font-size:12px;color:var(--t3);
}
.footer-wa{
  display:inline-flex;align-items:center;gap:7px;
  background:rgba(37,211,102,0.10);
  border:1px solid rgba(37,211,102,0.25);
  color:#25d366;
  font-size:12px;font-weight:700;
  padding:7px 14px;border-radius:20px;
  text-decoration:none;transition:all 0.2s;
}
.footer-wa:hover{background:rgba(37,211,102,0.18);transform:translateY(-1px);}

/* ── GEO STATS WIDGET ───────────────────────────────────────────── */
#geoWidget{
  position:fixed;bottom:20px;left:20px;
  background:var(--s1);
  border:1px solid var(--b2);
  border-radius:var(--r2);
  padding:12px 16px;
  font-size:11px;color:var(--t2);
  z-index:900;
  max-width:220px;
  box-shadow:0 8px 28px rgba(0,0,0,0.4);
  display:none;
  animation:slideUp 0.4s ease;
}
@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
#geoWidget .geo-flag{font-size:20px;margin-left:6px;}
#geoWidget .geo-title{font-weight:700;color:var(--p3);margin-bottom:2px;font-size:12px;}
#geoClose{
  position:absolute;top:6px;left:8px;
  background:none;border:none;color:var(--t3);
  cursor:pointer;font-size:14px;line-height:1;
  padding:2px;
}
#geoClose:hover{color:var(--t1);}

/* ── LIGHT MODE OVERRIDES ────────────────────────────────────────── */
body.light-mode .feat-card,
body.light-mode .plan-card,
body.light-mode .install-step,
body.light-mode .faq-item {
  background:#fff!important;
  border-color:rgba(45,212,191,0.10)!important;
}
body.light-mode .install-tabs,
body.light-mode .faq-list .faq-item,
body.light-mode footer {
  background:#fff!important;
}
body.light-mode footer,
body.light-mode #dashboard {
  background:#fff!important;
  border-color:rgba(45,212,191,0.08)!important;
}
body.light-mode .dash-mock {
  background:linear-gradient(160deg,#e8ecff,#edf0fc)!important;
}
body.light-mode .dash-mock-header{background:rgba(230,235,255,0.99)!important;border-color:rgba(45,212,191,0.14)!important;}
body.light-mode .stat-card{background:#fff!important;border-color:rgba(45,212,191,0.12)!important;}
body.light-mode #download,body.light-mode #final-cta,body.light-mode #faq {background:var(--bg)!important;}
body.light-mode .dl-req{background:#fff!important;border-color:rgba(45,212,191,0.10)!important;}
body.light-mode .pricing-note{color:var(--t3)!important;}
body.light-mode #geoWidget{background:rgba(253,252,248,0.97)!important;border-color:rgba(45,212,191,0.15)!important;}
body.light-mode .install-step{background:var(--bg)!important;}

/* ── ANIMATIONS ──────────────────────────────────────────────────── */
.fade-in{opacity:0;transform:translateY(24px);transition:opacity 0.55s ease,transform 0.55s ease;}
.fade-in.visible{opacity:1;transform:translateY(0);}
.fade-in-delay-1{transition-delay:0.10s;}
.fade-in-delay-2{transition-delay:0.20s;}
.fade-in-delay-3{transition-delay:0.30s;}
.fade-in-delay-4{transition-delay:0.40s;}


.plan-usd-lp {
  font-size: 11px; font-weight: 700;
  color: var(--ok); opacity: 0.85;
  background: rgba(34,211,160,0.10);
  border: 1px solid rgba(34,211,160,0.22);
  border-radius: 20px; padding: 2px 8px;
  margin-right: 6px; vertical-align: middle;
  font-family: 'Cairo', sans-serif;
}

@keyframes fadeUpSoft{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.fade-up-soft{animation:fadeUpSoft .7s ease both}
.icon-float{display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:14px;background:rgba(96,130,180,.12);border:1px solid rgba(96,130,180,.22);font-size:20px;margin-left:10px}
.video-shell{border-radius:20px;overflow:hidden;border:1px solid rgba(96,130,180,.2);box-shadow:0 20px 50px rgba(0,0,0,.35);background:#0a0e17}
.video-caption{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;justify-content:center}
.video-caption span{padding:8px 14px;border-radius:999px;background:rgba(96,130,180,.1);border:1px solid rgba(96,130,180,.2);font-size:12px;color:var(--t2);font-weight:700}
</style>
</head>
<body>
<?php
// شريط إشعارات الأدمن الظاهر فعليًا لكل زائر/مستخدم
if (function_exists('fbbf_active_announcements')):
  $annEmail = function_exists('fbbf_current_user_email') ? fbbf_current_user_email() : '';
  $siteAnn = fbbf_active_announcements($annEmail !== '' ? $annEmail : null);
  $siteAnn = array_values(array_filter($siteAnn, static function($a){
    return empty($a['seen']) && !empty($a['active']);
  }));
  if ($siteAnn):
    $top = $siteAnn[0];
    $atype = (string)($top['type'] ?? 'info');
    $bgAnn = $atype === 'urgent' ? '#7f1d1d' : ($atype === 'update' ? '#1e3a5f' : '#0f2a24');
?>
<div id="fbbf-site-ann" style="position:sticky;top:0;z-index:9999;background:<?= htmlspecialchars($bgAnn) ?>;color:#fff;padding:10px 14px;text-align:center;font-family:Cairo,Tahoma,sans-serif;font-size:13px;border-bottom:1px solid rgba(255,255,255,.15)">
  <strong><?= htmlspecialchars((string)($top['title'] ?? 'إشعار')) ?></strong>
  <span style="opacity:.95"> — <?= htmlspecialchars((string)($top['body'] ?? '')) ?></span>
  <?php if (!empty($top['cta_url'])): ?>
    <a href="<?= htmlspecialchars((string)$top['cta_url']) ?>" style="color:#7dd3fc;margin-right:8px;font-weight:700"><?= htmlspecialchars((string)($top['cta_label'] ?: 'المزيد')) ?></a>
  <?php endif; ?>
</div>
<?php endif; endif; ?>


<!-- ══ NAV ═══════════════════════════════════════════════════════════ -->
<nav id="siteNav">
  <div class="nav-inner">
    <a href="#" class="nav-logo">
      <svg class="nav-logo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hexGradLP" x1="10" y1="5" x2="90" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0f766e"/>
            <stop offset="100%" stop-color="#99f6e4"/>
          </linearGradient>
          <linearGradient id="fGradLP" x1="38" y1="28" x2="60" y2="72" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#bfdfff"/>
          </linearGradient>
        </defs>
        <polygon points="50,5 90,25 90,75 50,95 10,75 10,25" stroke="url(#hexGradLP)" stroke-width="4" fill="rgba(7,10,18,0.90)"/>
        <path d="M65 35C70 42 70 58 65 65" stroke="#99f6e4" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path d="M72 27C80 38 80 62 72 73" stroke="#0f766e" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M38 72V28H60M38 48H52" stroke="url(#fGradLP)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
      <div class="nav-brand">
        <span class="nav-brand-name">fb Bablushr F</span>
        <span class="nav-brand-tag">Stealth Engine</span>
      </div>
    </a>
    <ul class="nav-links" id="navLinks">
      <li><a href="#features">المميزات</a></li>
      <li><a href="#dashboard">لوحة التحكم</a></li>
      <li><a href="#pricing">الأسعار</a></li>
      <li><a href="#demo-video">الفيديو</a></li>
      <li><a href="#install">التثبيت</a></li>
      <li><a href="#faq">الأسئلة</a></li>
    </ul>
    <div class="nav-right">
      <span class="nav-version-chip">v16</span>
      <button id="themeToggleBtn" title="تبديل الوضع">
        <svg id="iconSun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg id="iconMoon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <?php if (!empty($navLogged)): ?>
      <a href="account.php" class="nav-dl-btn" style="background:linear-gradient(135deg,#2563eb,#7c3aed);">👤 حسابي</a>
      <a href="login-download.php" id="navDlBtn" class="nav-dl-btn">⬇️ تحميل</a>
      <?php else: ?>
      <a href="login-download.php" id="navDlBtn" class="nav-dl-btn">📥 تحميل مجاني</a>
      <?php endif; ?>
      <button class="hamburger" id="hamburgerBtn" aria-label="القائمة">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>

<!-- ══ HERO ══════════════════════════════════════════════════════════ -->
<section class="hero">
  <div class="fade-in">
    <div class="hero-eyebrow"><span class="dot"></span> محرك النشر الأكثر قدرة على الإطلاق</div>
    <h1 class="hero-h1"><span class="hero-h1-accent">انشر في مئات الجروبات</span></h1>
    <div class="hero-h1-sub">بضغطة واحدة · بذكاء اصطناعي مدمج</div>
    <p class="hero-desc">
      fb Bablushr F هو الإضافة الوحيدة التي تجمع النشر الجماعي في الخلفية · تنويع النصوص Spintax ·
      ذكاء اصطناعي Gemini مجانًا · Stealth Mode احترافي · وتعمل على هاتفك بنفس كفاءة الكمبيوتر.
    </p>
    <div class="hero-cta-row">
      <a href="login-download.php" id="heroDlBtn" class="btn-hero-dl">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        تحميل مجاني — v16
      </a>
      <a href="#install" class="btn-hero-demo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        شرح التثبيت
      </a>
    </div>
  </div>
  <div class="hero-stats fade-in fade-in-delay-1">
    <div class="stat-card"><span class="stat-num">500+</span><span class="stat-lbl">جروب دفعة واحدة</span></div>
    <div class="stat-card"><span class="stat-num gold">99%</span><span class="stat-lbl">معدل نجاح النشر</span></div>
    <div class="stat-card"><span class="stat-num">0</span><span class="stat-lbl">كشف من فيسبوك</span></div>
    <div class="stat-card"><span class="stat-num">4</span><span class="stat-lbl">خطط اشتراك مرنة</span></div>
  </div>
</section>

<!-- ══ FEATURES ═══════════════════════════════════════════════════════ -->
<section id="features">
  <div class="section-inner">
    <div class="fade-in">
      <div class="section-tag">⚡ المميزات</div>
      <h2 class="section-h2">كل ما تحتاجه <span class="text-accent">في مكان واحد</span></h2>
      <p class="section-sub">لم تعد بحاجة لأدوات متعددة. fb Bablushr F يجمع كل ما يحتاجه المسوّق الاحترافي في إضافة واحدة خفيفة.</p>
    </div>
    <div class="feats-grid">
      <div class="feat-card fade-in">
        <div class="feat-icon fi-indigo">⚡</div>
        <h3 class="feat-h3">نشر جماعي في الخلفية</h3>
        <p class="feat-p">انشر في 500+ مجموعة في نفس الوقت بينما تتصفح فيسبوك بشكل طبيعي تماماً. المحرك يعمل بصمت كامل في الخلفية دون انقطاع.</p>
        <div class="feat-tags"><span class="feat-tag">Background</span><span class="feat-tag">500+ جروب</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-1">
        <div class="feat-icon fi-gold">🤖</div>
        <h3 class="feat-h3">ذكاء اصطناعي Gemini 1.5 Flash مدمج مجانًا</h3>
        <p class="feat-p">توليد منشورات احترافية بالعربية والإنجليزية. كتابة هوك جذاب + محتوى + CTA لكل منشور تلقائياً بأسلوب يناسب مجالك.</p>
        <div class="feat-tags"><span class="feat-tag">Gemini AI</span><span class="feat-tag">مجاني</span><span class="feat-tag">عربي/إنجليزي</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-2">
        <div class="feat-icon fi-teal">🔄</div>
        <h3 class="feat-h3">Spintax — تنويع تلقائي لكل جروب</h3>
        <p class="feat-p">كل مجموعة تحصل على نص فريد مختلف 100% بصيغة {كلمة1|كلمة2}. هوك مختلف، CTA مختلف — يمنع الحظر ويزيد التفاعل.</p>
        <div class="feat-tags"><span class="feat-tag">Spintax</span><span class="feat-tag">Anti-spam</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-3">
        <div class="feat-icon fi-purple">🔒</div>
        <h3 class="feat-h3">Stealth Mode متعدد المستويات</h3>
        <p class="feat-p">أحرف Homoglyph مخفية · تأخيرات عشوائية · تعريف مستخدم ديناميكي · محاكاة حركة إنسانية. مستوى الوكالات الكبرى.</p>
        <div class="feat-tags"><span class="feat-tag">Homoglyph</span><span class="feat-tag">Anti-detection</span></div>
      </div>
      <div class="feat-card feat-new fade-in">
        <span class="feat-new-badge">✨ جديد</span>
        <div class="feat-icon fi-sky">📊</div>
        <h3 class="feat-h3">تحليلات بصرية — Analytics Dashboard</h3>
        <p class="feat-p">رسم بياني تفاعلي لآخر 14 يوم يعرض نجاحاتك وإخفاقاتك وأفضل أوقات النشر. تتبّع أداءك وحسّن استراتيجيتك بالأرقام الحقيقية.</p>
        <div class="feat-tags"><span class="feat-tag">Real-time</span><span class="feat-tag">14 يوم</span><span class="feat-tag">تصدير CSV</span></div>
      </div>
      <div class="feat-card feat-new fade-in fade-in-delay-1">
        <span class="feat-new-badge">✨ جديد</span>
        <div class="feat-icon fi-gold">📅</div>
        <h3 class="feat-h3">جدولة زمنية ذكية — Scheduler</h3>
        <p class="feat-p">جدِّل حملاتك بالتاريخ والوقت الدقيق. تعمل تلقائياً حتى لو أغلقت الهاتف. مدعومة بـ chrome.alarms للموثوقية الكاملة.</p>
        <div class="feat-tags"><span class="feat-tag">chrome.alarms</span><span class="feat-tag">Auto-run</span></div>
      </div>
      <div class="feat-card feat-new fade-in fade-in-delay-2">
        <span class="feat-new-badge">✨ جديد</span>
        <div class="feat-icon fi-rose">🎲</div>
        <h3 class="feat-h3">A/B Testing — اختبر واختر الأفضل</h3>
        <p class="feat-p">اكتب نسختين من منشورك، الإضافة تختار عشوائياً وتتتبّع أيهما يحقق نجاحاً أعلى. قرارات مبنية على بيانات حقيقية لا تخمين.</p>
        <div class="feat-tags"><span class="feat-tag">A/B Split</span><span class="feat-tag">إحصاءات</span></div>
      </div>
      <div class="feat-card feat-new fade-in fade-in-delay-3">
        <span class="feat-new-badge">✨ جديد</span>
        <div class="feat-icon fi-indigo">✨</div>
        <h3 class="feat-h3">توليد قوالب بالذكاء الاصطناعي</h3>
        <p class="feat-p">اكتب فكرتك بجملة واحدة — الذكاء الاصطناعي يبني قالباً كاملاً: عنوان، سعر، وصف، مميزات، CTA، وهاشتاجات. لـ 8 مجالات مختلفة.</p>
        <div class="feat-tags"><span class="feat-tag">AI Builder</span><span class="feat-tag">8 مجالات</span></div>
      </div>
      <div class="feat-card feat-new fade-in">
        <span class="feat-new-badge">✨ جديد</span>
        <div class="feat-icon fi-teal">👤</div>
        <h3 class="feat-h3">Multi-Profile — بروفايلات متعددة</h3>
        <p class="feat-p">احفظ إعدادات كاملة (مجموعات + محتوى + مفاتيح AI) لكل عميل أو مجال في بروفايل منفصل. بدّل بينها بنقرة واحدة فورياً.</p>
        <div class="feat-tags"><span class="feat-tag">Multi-Profile</span><span class="feat-tag">Switch</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-1">
        <div class="feat-icon fi-gold">📱</div>
        <h3 class="feat-h3">يعمل على الهاتف — Kiwi Browser</h3>
        <p class="feat-p">لا تحتاج كمبيوتر. اعمل من هاتفك بـ Kiwi Browser على أندرويد بنفس الكفاءة الكاملة. واجهة متجاوبة مُحسَّنة للشاشات الصغيرة.</p>
        <div class="feat-tags"><span class="feat-tag">Android</span><span class="feat-tag">Kiwi</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-2">
        <div class="feat-icon fi-sky">🔍</div>
        <h3 class="feat-h3">اكتشاف الجروبات الذكي</h3>
        <p class="feat-p">بحث وفلترة مئات الجروبات حسب الكلمة المفتاحية والحجم والنشاط. أضف دفعات ضخمة بنقرة واحدة. حفظ قوائم مخصصة بأسماء.</p>
        <div class="feat-tags"><span class="feat-tag">بحث ذكي</span><span class="feat-tag">فلترة</span></div>
      </div>
      <div class="feat-card fade-in fade-in-delay-3">
        <div class="feat-icon fi-rose">💬</div>
        <h3 class="feat-h3">نافذة منفصلة — Full Dashboard</h3>
        <p class="feat-p">افتح الإضافة في تبويب كامل الحجم للتحكم الكامل بحملاتك بشاشة واسعة. مثالي للكمبيوتر والتابلت مع لوحة تحكم شاملة.</p>
        <div class="feat-tags"><span class="feat-tag">Full Tab</span><span class="feat-tag">Dashboard</span></div>
      </div>
    </div>
  </div>
</section>

<!-- ══ DASHBOARD SECTION ══════════════════════════════════════════════ -->
<section id="dashboard">
  <div class="section-inner">
    <div class="dash-layout">
      <div class="fade-in">
        <div class="section-tag">🖥️ لوحة التحكم</div>
        <h2 class="section-h2">تحكّم كامل <span class="text-gold">من مكان واحد</span></h2>
        <p class="section-sub">لوحة تحكم احترافية بتصميم داكن أنيق — تتابع نشاطك الكامل، تدير حملاتك، وترى الإحصاءات في الوقت الفعلي.</p>
        <div class="dash-features-list">
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">مراقبة مباشرة لكل منشور</div><div class="dash-feat-desc">شاهد حالة كل مجموعة لحظة بلحظة — نجح أم في الانتظار أم واجه خطأً</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">📊 تحليلات بصرية — آخر 14 يوم</div><div class="dash-feat-desc">رسم بياني تفاعلي يعرض نجاحاتك وإخفاقاتك وأفضل أوقات النشر تلقائياً</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">📅 جدولة زمنية ذكية</div><div class="dash-feat-desc">حدد تاريخاً ووقتاً مستقبلياً وتشغيل تلقائي حتى لو أغلقت الهاتف</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">🎲 A/B Testing للمحتوى</div><div class="dash-feat-desc">جرّب نسختين من منشورك وتتبّع أيهما يحقق نسبة نجاح أعلى بالأرقام الحقيقية</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">✨ توليد قوالب بالذكاء الاصطناعي</div><div class="dash-feat-desc">جملة واحدة تكفي — الذكاء الاصطناعي يبني قالباً احترافياً كاملاً لـ 8 مجالات</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">👤 Multi-Profile — بروفايلات متعددة</div><div class="dash-feat-desc">احفظ إعدادات كل عميل أو مجال في بروفايل منفصل وبدّل بينها فورياً</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">تبديل ليلي / نهاري</div><div class="dash-feat-desc">ثيم داكن احترافي وثيم فاتح نظيف — مريح للعين في أي وقت من اليوم</div></div>
          </div>
          <div class="dash-feat-item">
            <div class="dash-feat-check">✓</div>
            <div><div class="dash-feat-title">تصدير التقارير</div><div class="dash-feat-desc">صدِّر سجل حملاتك بصيغة CSV أو HTML لأرشفة نتائجك أو تقديمها للعملاء</div></div>
          </div>
        </div>
      </div>
      <div class="dash-img-wrap fade-in fade-in-delay-1">
        <div class="demo-dash">
          <div class="demo-dash-header">
            <div class="demo-dash-dot" style="background:#f05068;"></div>
            <div class="demo-dash-dot" style="background:#f5b840;margin:0 4px;"></div>
            <div class="demo-dash-dot" style="background:#22d3a0;"></div>
            <div class="demo-dash-header-title">لوحة التحكم — fb Bablushr F</div>
          </div>
          <div class="demo-dash-body">

            <!-- Overview cards — matches the real dashboard's overview-grid exactly -->
            <div class="demo-overview-grid">
              <div class="demo-overview-card">
                <span>جاهزية الجلسة</span>
                <strong>Facebook</strong>
              </div>
              <div class="demo-overview-card">
                <span>حالة الطابور</span>
                <strong>جاهز</strong>
              </div>
              <div class="demo-overview-card accent">
                <span>وضع التشغيل</span>
                <strong>Stealth Engine</strong>
              </div>
            </div>

            <!-- Mini analytics chart — static SVG replica of the real 14-day bar chart,
                 including the new amber comment-failure indicator dots -->
            <div class="demo-chart-card">
              <div class="demo-chart-title">📊 آخر 14 يوم <span class="demo-chart-legend"><i style="background:#2dd4bf"></i>نجاح <i style="background:#fca5a5"></i>فشل <i class="demo-dot-amber"></i>تعليق</span></div>
              <svg viewBox="0 0 300 90" class="demo-chart-svg" preserveAspectRatio="none">
                <g>
                  <rect x="4"   y="40" width="14" height="46" rx="2" fill="#0f766e"/>
                  <rect x="22"  y="55" width="14" height="31" rx="2" fill="#0f766e"/>
                  <circle cx="29" cy="49" r="2" fill="#fcd34d"/>
                  <rect x="40"  y="25" width="14" height="61" rx="2" fill="#0f766e"/>
                  <rect x="58"  y="60" width="14" height="18" rx="2" fill="#fca5a5"/>
                  <rect x="58"  y="20" width="14" height="40" rx="2" fill="#0f766e"/>
                  <rect x="76"  y="48" width="14" height="38" rx="2" fill="#0f766e"/>
                  <rect x="94"  y="65" width="14" height="21" rx="2" fill="#0f766e"/>
                  <circle cx="101" cy="59" r="2" fill="#fcd34d"/>
                  <rect x="112" y="35" width="14" height="51" rx="2" fill="#0f766e"/>
                  <rect x="130" y="15" width="14" height="71" rx="2" fill="#0f766e"/>
                  <rect x="148" y="58" width="14" height="14" rx="2" fill="#fca5a5"/>
                  <rect x="148" y="20" width="14" height="38" rx="2" fill="#0f766e"/>
                  <rect x="166" y="42" width="14" height="44" rx="2" fill="#0f766e"/>
                  <rect x="184" y="30" width="14" height="56" rx="2" fill="#0f766e"/>
                  <circle cx="191" cy="24" r="2" fill="#fcd34d"/>
                  <rect x="202" y="52" width="14" height="34" rx="2" fill="#0f766e"/>
                  <rect x="220" y="10" width="14" height="76" rx="2" fill="#0f766e"/>
                  <rect x="238" y="45" width="14" height="41" rx="2" fill="#0f766e"/>
                  <rect x="256" y="62" width="14" height="12" rx="2" fill="#fca5a5"/>
                  <rect x="256" y="28" width="14" height="34" rx="2" fill="#0f766e"/>
                  <rect x="274" y="18" width="14" height="68" rx="2" fill="#0f766e"/>
                </g>
              </svg>
            </div>

            <!-- Recent activity log — realistic sample entries matching the real log row template -->
            <div class="demo-log-card">
              <div class="demo-log-title">آخر النشاطات</div>
              <div class="demo-log-row">
                <div class="demo-log-title-line ok">✅ نجاح — جروب عروض التسويق الرقمي</div>
                <div class="demo-log-meta">💬 التعليق الأول: نجح</div>
              </div>
              <div class="demo-log-row">
                <div class="demo-log-title-line ok">✅ نجاح — مجموعة رواد الأعمال</div>
              </div>
              <div class="demo-log-row">
                <div class="demo-log-title-line warn">⏳ قيد الانتظار — جروب المنتجات المصرية</div>
              </div>
              <div class="demo-log-row">
                <div class="demo-log-title-line bad">❌ فشل — جروب الوظائف والتوظيف</div>
                <div class="demo-log-meta bad">💬 التعليق الأول: فشل — تعذّر إيجاد خانة التعليق</div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
/* ══════════════════════════════════════════════════════════════════
   Dashboard live-preview replica — isolated "demo-*" class names so
   nothing here can ever collide with the rest of the site's CSS.
   Values match /extension/dashboard.css exactly (same Verdigris tokens).
   ══════════════════════════════════════════════════════════════════ */
.demo-dash{background:#0e0c0a;border:1px solid rgba(45,167,159,0.20);border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.demo-dash-header{display:flex;align-items:center;gap:6px;padding:12px 14px;background:#1c1916;border-bottom:1px solid rgba(45,167,159,0.14);}
.demo-dash-dot{width:10px;height:10px;border-radius:50%;}
.demo-dash-header-title{flex:1;text-align:center;font-size:12px;color:#756c5f;font-weight:700;}
.demo-dash-body{padding:16px;display:flex;flex-direction:column;gap:12px;}

.demo-overview-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.demo-overview-card{background:#1c1916;border:1px solid rgba(45,212,191,0.14);border-radius:10px;padding:10px 12px;position:relative;}
.demo-overview-card span{color:#756c5f;font-size:9px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;display:block;margin-bottom:5px;}
.demo-overview-card strong{display:block;font-size:14px;color:#f5f2ec;}
.demo-overview-card.accent{border-color:rgba(45,212,191,0.30);}
.demo-overview-card.accent strong{color:#2dd4bf;}

.demo-chart-card{background:#1c1916;border:1px solid rgba(45,167,159,0.14);border-radius:10px;padding:12px;}
.demo-chart-title{font-size:11px;color:#b8afa0;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.demo-chart-legend{font-size:9px;color:#756c5f;font-weight:400;display:inline-flex;align-items:center;gap:4px;}
.demo-chart-legend i{width:6px;height:6px;border-radius:2px;display:inline-block;margin-inline-start:6px;}
.demo-dot-amber{width:6px!important;height:6px!important;border-radius:50%!important;background:#fcd34d;}
.demo-chart-svg{width:100%;height:70px;display:block;}

.demo-log-card{background:#1c1916;border:1px solid rgba(45,167,159,0.14);border-radius:10px;padding:12px;}
.demo-log-title{font-size:11px;color:#b8afa0;font-weight:700;margin-bottom:8px;}
.demo-log-row{padding:8px 0;border-bottom:1px solid rgba(45,167,159,0.08);}
.demo-log-row:last-child{border-bottom:none;padding-bottom:0;}
.demo-log-title-line{font-size:11.5px;font-weight:700;}
.demo-log-title-line.ok{color:#86efac;}
.demo-log-title-line.warn{color:#fcd34d;}
.demo-log-title-line.bad{color:#fca5a5;}
.demo-log-meta{font-size:10.5px;color:#756c5f;margin-top:3px;}
.demo-log-meta.bad{color:#fca5a5;}

@media (max-width:760px){
  .demo-overview-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
  .demo-overview-card strong{font-size:12px;}
}
</style>

<!-- ══ HOW IT WORKS ═══════════════════════════════════════════════════ -->
<section id="how">
  <div class="section-inner">
    <div class="fade-in" style="text-align:center;">
      <div class="section-tag">📋 كيف يعمل</div>
      <h2 class="section-h2">3 خطوات فقط <span class="text-accent">وابدأ النشر</span></h2>
      <p class="section-sub" style="margin:0 auto 48px;">لا تحتاج خبرة تقنية. من تحميل الإضافة إلى النشر في 500 جروب في أقل من 5 دقائق.</p>
    </div>
    <div class="steps-timeline fade-in">
      <div class="step-card">
        <div class="step-num">١</div>
        <h3 class="step-title">حمِّل وثبِّت</h3>
        <p class="step-desc">حمِّل ملف الإضافة وثبِّته على كروم أو كيوي في أقل من دقيقة بدون متجر التطبيقات</p>
      </div>
      <div class="step-card">
        <div class="step-num">٢</div>
        <h3 class="step-title">اكتب أو اطلب من AI</h3>
        <p class="step-desc">اكتب منشورك يدوياً أو اطلب من Gemini AI كتابة محتوى احترافي بلغتك وباسلوبك</p>
      </div>
      <div class="step-card">
        <div class="step-num">٣</div>
        <h3 class="step-title">اختر الجروبات</h3>
        <p class="step-desc">استعرض واختر مئات الجروبات من قوائمك المحفوظة أو ابحث عن جروبات جديدة بالكلمة المفتاحية</p>
      </div>
      <div class="step-card">
        <div class="step-num">٤</div>
        <h3 class="step-title">اضغط ابدأ 🚀</h3>
        <p class="step-desc">المحرك يعمل في الخلفية تلقائياً — تصفح بشكل طبيعي وتابع النتائج مباشرة على الشاشة</p>
      </div>
    </div>
  </div>
</section>

<!-- ══ PRICING ════════════════════════════════════════════════════════ -->
<section id="pricing">
  <div class="section-inner">
    <div class="fade-in" style="text-align:center;">
      <div class="section-tag">💰 الأسعار</div>
      <h2 class="section-h2">اشتراك شفاف <span class="text-gold">بدون مفاجآت</span></h2>
      <p class="section-sub" style="margin:0 auto 48px;">ادفع بالجنيه المصري عبر فودافون كاش · لا بطاقة بنكية · إلغاء في أي وقت</p>
    </div>
    <div class="pricing-grid fade-in">
      <!-- شهري -->
      <div class="plan-card">
        <div class="plan-name">شهري</div>
        <div class="plan-price-wrap">
          <span class="plan-price">99</span><span class="plan-usd-lp">~$2</span>
          <span class="plan-currency">جنيه</span>
          <span class="plan-period">/ شهر</span>
        </div>
        <div class="plan-divider"></div>
        <ul class="plan-features-list">
          <li><span class="plan-check">✓</span>نشر في الخلفية بلا حدود</li>
          <li><span class="plan-check">✓</span>اكتشاف الجروبات</li>
          <li><span class="plan-check">✓</span>Gemini + HuggingFace مجانًا</li>
          <li><span class="plan-check">✓</span>Spintax تلقائي</li>
          <li><span class="plan-check">✓</span>تحليلات مباشرة</li>
          <li><span class="plan-check">✓</span>Stealth Mode أساسي</li>
        </ul>
        <button class="btn-plan btn-plan-default" onclick="location.href='/payment.php'">اشترك الآن</button>
      </div>
      <!-- ربع سنوي -->
      <div class="plan-card featured">
        <div class="plan-ribbon ribbon-gold">⭐ الأكثر طلباً</div>
        <div class="plan-name">ربع سنوي</div>
        <div class="plan-price-wrap">
          <span class="plan-price">499</span><span class="plan-usd-lp">~$10</span>
          <span class="plan-currency">جنيه</span>
          <span class="plan-period">/ 3 شهور</span>
        </div>
        <div class="plan-per-month">≈ 166 جنيه/شهر (~$3.3) · وفِّر 17%</div>
        <div class="plan-divider"></div>
        <ul class="plan-features-list">
          <li><span class="plan-check">✓</span>كل مميزات الشهري</li>
          <li><span class="plan-star">⭐</span>Stealth Mode متقدم</li>
          <li><span class="plan-star">⭐</span>دعم أولوية 24/7</li>
          <li><span class="plan-star">⭐</span>حماية متعددة الحسابات</li>
          <li><span class="plan-star">⭐</span>تحديثات مجانية فورية</li>
          <li><span class="plan-check">✓</span>توفير 20% مقارنة بالشهري</li>
        </ul>
        <button class="btn-plan btn-plan-gold" onclick="location.href='/payment.php'">اشترك الآن</button>
      </div>
      <!-- نصف سنوي -->
      <div class="plan-card">
        <div class="plan-name">نصف سنوي</div>
        <div class="plan-price-wrap">
          <span class="plan-price">899</span><span class="plan-usd-lp">~$18</span>
          <span class="plan-currency">جنيه</span>
          <span class="plan-period">/ 6 شهور</span>
        </div>
        <div class="plan-per-month">≈ 166 جنيه/شهر (~$3.3) · وفِّر 17%</div>
        <div class="plan-divider"></div>
        <ul class="plan-features-list">
          <li><span class="plan-check">✓</span>كل مميزات الربع سنوي</li>
          <li><span class="plan-star">⭐</span>نسخة بيتا مبكرة</li>
          <li><span class="plan-star">⭐</span>قناة دعم مخصصة</li>
          <li><span class="plan-star">⭐</span>أولوية في الطلبات</li>
          <li><span class="plan-check">✓</span>وفِّر ~200 جنيه مقارنةً بالربعي</li>
        </ul>
        <button class="btn-plan btn-plan-default" onclick="location.href='/payment.php'">اشترك الآن</button>
      </div>
      <!-- سنوي -->
      <div class="plan-card purple-plan">
        <div class="plan-ribbon ribbon-purple">🔮 الأفضل قيمة</div>
        <div class="plan-name">سنوي</div>
        <div class="plan-price-wrap">
          <span class="plan-price">1,499</span><span class="plan-usd-lp">~$30</span>
          <span class="plan-currency">جنيه</span>
          <span class="plan-period">/ سنة</span>
        </div>
        <div class="plan-per-month">≈ 125 جنيه/شهر (~$2.5) · وفِّر 37%</div>
        <div class="plan-divider"></div>
        <ul class="plan-features-list">
          <li><span class="plan-check">✓</span>كل المميزات بالكامل</li>
          <li><span class="plan-star">⭐</span>وصول VIP مدى الحياة</li>
          <li><span class="plan-star">⭐</span>تدريب مجاني على الأداة</li>
          <li><span class="plan-star">⭐</span>ذكاء اصطناعي بلا حدود</li>
          <li><span class="plan-star">⭐</span>أفضل قيمة في السوق</li>
          <li><span class="plan-check">✓</span>وفِّر ~650 جنيه — التوفير الأمثل</li>
        </ul>
        <button class="btn-plan btn-plan-purple" onclick="location.href='/payment.php'">اشترك الآن</button>
      </div>
    </div>
    <p class="pricing-note fade-in">💳 الدفع عبر فودافون كاش · <a href="payment.php" style="color:var(--p2);text-decoration:underline;font-weight:800;">صفحة الدفع والتفعيل</a> · أو واتساب <a href="https://wa.me/201277181217" target="_blank" rel="noopener" style="color:var(--ok);text-decoration:underline;">01277181217</a></p>
  </div>
</section>

<!-- ══ DOWNLOAD SECTION ═══════════════════════════════════════════════ -->
<section id="download">
  <div class="section-inner" style="text-align:center;">
    <div class="fade-in">
      <div class="dl-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        مجاني للتحميل — التفعيل يتطلب اشتراك
      </div>
      <h2 class="section-h2">حمِّل <span class="text-accent">fb Bablushr F</span> الآن</h2>
      <p class="dl-version">الإصدار v16.0 · آخر تحديث: يونيو 2026 · حجم الملف: ~520 KB</p>
      <div class="dl-requirements">
        <div class="dl-req"><span class="dl-req-icon">🌐</span> Chrome 88+</div>
        <div class="dl-req"><span class="dl-req-icon">📱</span> Kiwi Browser (Android)</div>
        <div class="dl-req"><span class="dl-req-icon">🍋</span> Lemur / Chromium Android</div>
        <div class="dl-req"><span class="dl-req-icon">💻</span> Windows / macOS / Linux</div>
        <div class="dl-req"><span class="dl-req-icon">📲</span> Android 7.0+</div>
      </div>
      <div>
        <a href="login-download.php" id="mainDlBtn" class="btn-download-big">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          تحميل الإضافة الآن — v16.5.21
        </a>
      </div>
      <p class="dl-fileinfo">ملف مضغوط ZIP · <a onclick="document.getElementById('install').scrollIntoView({behavior:'smooth'});return false;">شرح التثبيت بالتفصيل ↓</a></p>
    </div>
  </div>
</section>

<!-- ══ INSTALL GUIDE ═══════════════════════════════════════════════════ -->

<!-- ═══ فيديو توضيحي ═══ -->
<section id="demo-video" style="padding:60px 0;background:var(--s2);border-top:1px solid var(--b1);">
  <div class="container" style="max-width:960px;margin:0 auto;padding:0 20px;">
    <div class="section-header" style="text-align:center;margin-bottom:28px;">
      <div class="section-eyebrow">▶ شاهد كيف تعمل</div>
      <h2 class="section-h2">فيديو <span class="text-accent">التثبيت والتشغيل</span></h2>
      <p class="section-desc" style="color:var(--t2);max-width:640px;margin:10px auto 0;line-height:1.7">
        شرح عملي بالترتيب: فتح فيسبوك على الهاتف · وضع سطح المكتب · فتح الإضافة · تسجيل الدخول · مسح الجروبات · النشر
      </p>
    </div>

    <div class="video-responsive-wrap" style="position:relative;width:100%;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:20px;border:1px solid var(--b2);box-shadow:0 20px 50px rgba(0,0,0,.45);background:#0a0e17;">
      <video
        id="demoVideoLocal"
        controls
        playsinline
        preload="metadata"
        poster="media/demo-poster.jpg"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0a0e17;"
        src="media/demo.mp4">
        متصفحك لا يدعم تشغيل الفيديو.
        <a href="media/demo.mp4" style="color:var(--p2)">حمّل الملف</a>
      </video>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:18px 0 8px;">
      <span style="padding:8px 14px;border-radius:999px;background:rgba(96,130,180,.12);border:1px solid rgba(96,130,180,.22);font-size:12px;font-weight:700;color:var(--t2)">📱 الهاتف</span>
      <span style="padding:8px 14px;border-radius:999px;background:rgba(96,130,180,.12);border:1px solid rgba(96,130,180,.22);font-size:12px;font-weight:700;color:var(--t2)">🖥️ وضع سطح المكتب</span>
      <span style="padding:8px 14px;border-radius:999px;background:rgba(96,130,180,.12);border:1px solid rgba(96,130,180,.22);font-size:12px;font-weight:700;color:var(--t2)">🥝 Kiwi / Quetta / Lemur</span>
      <span style="padding:8px 14px;border-radius:999px;background:rgba(96,130,180,.12);border:1px solid rgba(96,130,180,.22);font-size:12px;font-weight:700;color:var(--t2)">💻 Chrome / Edge</span>
    </div>

    <h3 style="text-align:center;margin:36px 0 8px;font-size:clamp(18px,4vw,22px);color:var(--t1)">خطوات التشغيل على الهاتف (بالترتيب)</h3>
    <p style="text-align:center;color:var(--t2);font-size:13px;margin:0 0 22px;line-height:1.6">
      مهم: على الهاتف لازم تفتح فيسبوك في <strong style="color:var(--p2)">وضع سطح المكتب (Desktop site)</strong> عشان الإضافة تشتغل صح.
    </p>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step1-open-groups.jpg" alt="خطوة 1" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">① افتح فيسبوك → المجموعات</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">من Kiwi أو Quetta افتح facebook.com/groups بعد تفعيل «إصدار سطح المكتب / Desktop site» من قائمة المتصفح.</div>
        </div>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step2-open-extension.jpg" alt="خطوة 2" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">② افتح الإضافة من شريط الأدوات</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">اضغط أيقونة الإضافة «fb Bablushr F» من قائمة الإضافات. لو مش ظاهرة: فعّل الإضافة من kiwi://extensions.</div>
        </div>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step3-login.jpg" alt="خطوة 3" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">③ سجّل دخول بنفس بيانات الموقع</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">استخدم نفس الإيميل وكلمة السر اللي سجّلت بيها على faset.xo.je — التجربة 3 أيام تتفعّل تلقائيًا.</div>
        </div>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step4-publish.jpg" alt="خطوة 4" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">④ تبويب المنشور + توليد المحتوى</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">اكتب منشورك أو ولّده بالذكاء الاصطناعي، أضف رابط/وسائط، واترك «تعليق أول» مغلق إلا لو محتاجه.</div>
        </div>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step5-groups-scan.jpg" alt="خطوة 5" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">⑤ مسح الجروبات واختيارها</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">من تبويب الجروبات اضغط «مسح الجروبات» بعد ربط جلسة فيسبوك، حدّد اللي هتنشر فيها، ثم ابدأ الحملة.</div>
        </div>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b2);border-radius:16px;overflow:hidden;">
        <img src="media/steps/step6-ai-settings.jpg" alt="خطوة 6" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;">
        <div style="padding:14px 16px;">
          <div style="font-weight:900;color:var(--p2);margin-bottom:6px;">⑥ إعدادات AI (اختياري)</div>
          <div style="font-size:13px;color:var(--t2);line-height:1.6">من الإعدادات الصق مفتاح Gemini (مجاني من aistudio.google.com) أو HuggingFace لتوليد منشورات أقوى.</div>
        </div>
      </div>
    </div>

    <div style="margin-top:28px;padding:18px 20px;border-radius:16px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);">
      <div style="font-weight:900;color:#fbbf24;margin-bottom:8px;">⚠️ لو زر الدخول مش بيشتغل</div>
      <ul style="margin:0;padding-right:18px;color:var(--t2);font-size:13px;line-height:1.8;">
        <li>تأكد إنك بتستخدم نفس الإيميل اللي اتعمل بيه الحساب على الموقع.</li>
        <li>لو سجّلت بـ Google على الموقع: ادخل من حسابي وحدد كلمة سر، أو سجّل من الإضافة بنفس الإيميل كـ «إنشاء حساب» بكلمة سر جديدة.</li>
        <li>لو ظهرت رسالة «حد الأجهزة»: من لوحة الأدمن اضغط «تجربة جديدة» أو «تفعيل» للمستخدم عشان يتصفّر قفل الجهاز.</li>
        <li>على الهاتف: لازم وضع سطح المكتب + اتصال إنترنت مستقر.</li>
      </ul>
    </div>
  </div>
</section>

<section id="install">

  <div class="section-inner">
    <div class="fade-in">
      <div class="section-tag">📖 التثبيت</div>
      <h2 class="section-h2">شرح التثبيت <span class="text-accent">خطوة بخطوة</span></h2>
      <p class="section-sub">اختر متصفحك وجهازك واتبع الخطوات البسيطة. لا خبرة تقنية مطلوبة.</p>
    </div>
    <div class="fade-in">
      <div class="install-tabs" role="tablist">
        <button class="install-tab active" onclick="switchTab('chrome')" id="tab-chrome">🌐 Chrome / Edge</button>
        <button class="install-tab" onclick="switchTab('kiwi')" id="tab-kiwi">📱 Kiwi Android</button>
        <button class="install-tab" onclick="switchTab('quetta')" id="tab-quetta">🐚 Quetta</button>
        <button class="install-tab" onclick="switchTab('lemur')" id="tab-lemur">🍋 Lemur / أخرى</button>
        <button class="install-tab" onclick="switchTab('tablet')" id="tab-tablet">🗒️ تابلت / كمبيوتر</button>
      </div>

      <!-- Chrome Panel -->
      <div class="install-panel active" id="panel-chrome">
        <div class="install-steps-list">
          <div class="install-step"><div class="install-step-num">١</div><div class="install-step-body"><div class="install-step-title">تحميل الملف</div><div class="install-step-desc">اضغط زر "تحميل الإضافة" في الأعلى. سيُحفظ ملف <code>fb-bablushr-f-v16.5.21-extension.zip</code> في مجلد التنزيلات.</div></div></div>
          <div class="install-step"><div class="install-step-num">٢</div><div class="install-step-body"><div class="install-step-title">فك ضغط الملف</div><div class="install-step-desc">انقر بالزر الأيمن على الملف واختر "استخراج هنا" أو "Extract Here". ستحصل على مجلد بداخله ملفات الإضافة.</div></div></div>
          <div class="install-step"><div class="install-step-num">٣</div><div class="install-step-body"><div class="install-step-title">فتح إدارة الإضافات</div><div class="install-step-desc">في شريط العنوان اكتب <code>chrome://extensions</code> واضغط Enter. أو من القائمة: المزيد من الأدوات → الإضافات.</div></div></div>
          <div class="install-step"><div class="install-step-num">٤</div><div class="install-step-body"><div class="install-step-title">تفعيل وضع المطور</div><div class="install-step-desc">في الزاوية العليا اليمنى فعِّل مفتاح "وضع المطوّر" أو Developer mode. سيظهر شريط أدوات جديد.</div></div></div>
          <div class="install-step"><div class="install-step-num">٥</div><div class="install-step-body"><div class="install-step-title">تحميل الإضافة</div><div class="install-step-desc">اضغط "Load unpacked" أو "تحميل غير معبّأ". اختر مجلد الإضافة الذي استخرجته في الخطوة الثانية.</div></div></div>
          <div class="install-step"><div class="install-step-num">٦</div><div class="install-step-body"><div class="install-step-title">انتهى! 🎉</div><div class="install-step-desc">ستجد أيقونة fb Bablushr F في شريط الأدوات. اضغط عليها وسجّل الدخول أو ابدأ تجربتك المجانية.</div></div></div>
        </div>
        <div class="install-tip">💡 <strong>تلميح:</strong> إذا اختفت الإضافة بعد إغلاق Chrome، افتح extensions وتأكد أنها مفعّلة. هذا طبيعي في الإضافات غير الرسمية.</div>
      </div>

      <!-- Kiwi Panel -->
      <div class="install-panel" id="panel-kiwi">
        <div class="install-steps-list">
          <div class="install-step"><div class="install-step-num">١</div><div class="install-step-body"><div class="install-step-title">حمِّل Kiwi Browser</div><div class="install-step-desc">من Google Play Store حمِّل تطبيق <code>Kiwi Browser</code> — متصفح مجاني يدعم إضافات Chrome على أندرويد.</div></div></div>
          <div class="install-step"><div class="install-step-num">٢</div><div class="install-step-body"><div class="install-step-title">تحميل ملف الإضافة</div><div class="install-step-desc">افتح هذه الصفحة في Kiwi Browser وحمِّل ملف <code>fb-bablushr-f-v16.5.21-extension.zip</code>. سيُحفظ في مجلد Downloads.</div></div></div>
          <div class="install-step"><div class="install-step-num">٣</div><div class="install-step-body"><div class="install-step-title">فتح إدارة الإضافات</div><div class="install-step-desc">في Kiwi اكتب في شريط العنوان: <code>kiwi://extensions</code> واضغط انتقال.</div></div></div>
          <div class="install-step"><div class="install-step-num">٤</div><div class="install-step-body"><div class="install-step-title">تفعيل Developer Mode</div><div class="install-step-desc">في الزاوية العلوية اليمنى فعِّل مفتاح Developer mode. اضغط <code>+ (from .zip/.crx/.user.js)</code>.</div></div></div>
          <div class="install-step"><div class="install-step-num">٥</div><div class="install-step-body"><div class="install-step-title">اختيار الملف</div><div class="install-step-desc">سيفتح مدير الملفات — انتقل لـ Downloads واختر الملف المضغوط. Kiwi سيثبّته تلقائياً.</div></div></div>
          <div class="install-step"><div class="install-step-num">٦</div><div class="install-step-body"><div class="install-step-title">استخدام الإضافة</div><div class="install-step-desc">اضغط القائمة ⋮ ثم Extensions وستجد fb Bablushr F. افتحها وسجِّل الدخول وابدأ النشر من هاتفك.</div></div></div>
        </div>
        <div class="install-tip">📱 <strong>تلميح للهاتف:</strong> اضغط على أيقونة الإضافة واختر "Open in new tab" للحصول على نافذة كاملة الشاشة مريحة أكثر.</div>
      </div>

      <!-- Quetta Panel -->
      <div class="install-panel" id="panel-quetta">
        <div class="install-steps-list">
          <div class="install-step"><div class="install-step-num">١</div><div class="install-step-body"><div class="install-step-title">حمِّل Quetta Browser</div><div class="install-step-desc">من Google Play Store حمِّل تطبيق <code>Quetta</code> (أو QuetaX) — متصفح أندرويد بديل مبني على Chromium وبيدعم إضافات كروم زي Kiwi Browser.</div></div></div>
          <div class="install-step"><div class="install-step-num">٢</div><div class="install-step-body"><div class="install-step-title">تحميل ملف الإضافة</div><div class="install-step-desc">افتح هذه الصفحة داخل Quetta وحمِّل ملف <code>fb-bablushr-f-v16.5.21-extension.zip</code>. سيُحفظ في مجلد Downloads بجهازك.</div></div></div>
          <div class="install-step"><div class="install-step-num">٣</div><div class="install-step-body"><div class="install-step-title">فتح إدارة الإضافات</div><div class="install-step-desc">اضغط على قائمة المتصفح (⋮) وابحث عن "Extensions" أو "الإضافات". لو مش لاقيها في القائمة، جرّب تكتب <code>quetta://extensions</code> في شريط العنوان.</div></div></div>
          <div class="install-step"><div class="install-step-num">٤</div><div class="install-step-body"><div class="install-step-title">تفعيل وضع المطوّر</div><div class="install-step-desc">في صفحة الإضافات، فعِّل مفتاح "Developer mode" أو "وضع المطوّر" (عادةً في الزاوية العلوية). سيظهر خيار إضافة ملف مضغوط.</div></div></div>
          <div class="install-step"><div class="install-step-num">٥</div><div class="install-step-body"><div class="install-step-title">تثبيت الملف</div><div class="install-step-desc">اضغط على خيار إضافة إضافة من ملف (زي "Load from .zip" أو ما يشابهه) واختر الملف اللي حملته من Downloads.</div></div></div>
          <div class="install-step"><div class="install-step-num">٦</div><div class="install-step-body"><div class="install-step-title">استخدام الإضافة</div><div class="install-step-desc">هتلاقي أيقونة fb Bablushr F ظاهرة في شريط الإضافات. افتحها وسجِّل الدخول أو ابدأ تجربتك المجانية.</div></div></div>
        </div>
        <div class="install-tip">⚠️ <strong>ملاحظة مهمة:</strong> Quetta بديل أحدث وأقل انتشارًا من Kiwi Browser، وتفاصيل القوائم الداخلية عنده ممكن تختلف قليلاً حسب نسخة التطبيق. لو الخطوات دي ما طابقتش الواجهة بالظبط، دوّر على أي خيار اسمه "Extensions" أو "الإضافات" في قائمة المتصفح — المبدأ العام واحد. لو واجهت أي مشكلة، Kiwi Browser هو الأكثر استقرارًا وتجربة مضمونة على أندرويد حاليًا.</div>
      </div>

      <!-- Lemur + other Chromium mobile browsers -->
      <div class="install-panel" id="panel-lemur">
        <div class="install-steps-list">
          <div class="install-step"><div class="install-step-num">١</div><div class="install-step-body"><div class="install-step-title">حمِّل متصفح يدعم الإضافات</div><div class="install-step-desc">على أندرويد: <strong>Quetta</strong> أو <strong>Lemur Browser</strong> أو <strong>Kiwi Browser</strong> أو أي متصفح Chromium من المتجر يدعم قائمة <code>Extensions</code>. على الكمبيوتر: Chrome · Edge · Brave · Opera تعمل مباشرة.</div></div></div>
          <div class="install-step"><div class="install-step-num">٢</div><div class="install-step-body"><div class="install-step-title">حمِّل ملف الإضافة</div><div class="install-step-desc">من هذه الصفحة حمِّل ملف ZIP الخاص بالإضافة واحفظه على الجهاز.</div></div></div>
          <div class="install-step"><div class="install-step-num">٣</div><div class="install-step-body"><div class="install-step-title">افتح صفحة الإضافات</div><div class="install-step-desc">من قائمة المتصفح اختر Extensions، أو اكتب في العنوان: <code>chrome://extensions</code> / <code>quetta://extensions</code> / <code>kiwi://extensions</code>.</div></div></div>
          <div class="install-step"><div class="install-step-num">٤</div><div class="install-step-body"><div class="install-step-title">فعّل وضع المطوّر وثبّت</div><div class="install-step-desc">فعّل Developer mode ثم Load unpacked أو Install from ZIP حسب المتصفح.</div></div></div>
        </div>
        <div class="install-tip">✅ الإضافة مبنية لـ Chromium — تعمل بسلاسة على الكمبيوتر حتى عند فتح برامج أخرى، وعلى الهاتف داخل المتصفحات التي تدعم إضافات كروم. <strong>Firefox غير مدعوم</strong>.</div>
      </div>

      <!-- Tablet Panel -->
      <div class="install-panel" id="panel-tablet">
        <div class="install-steps-list">
          <div class="install-step"><div class="install-step-num">١</div><div class="install-step-body"><div class="install-step-title">تابلت أندرويد</div><div class="install-step-desc">ثبِّت <code>Kiwi Browser</code> من Play Store وعمليات الأقل نفس خطوات الهاتف الأندرويد بالضبط. الإضافة مُحسَّنة للشاشات الكبيرة.</div></div></div>
          <div class="install-step"><div class="install-step-num">٢</div><div class="install-step-body"><div class="install-step-title">iPad / iOS</div><div class="install-step-desc">حالياً لا يدعم Safari على iOS الإضافات. يمكن استخدام <code>Orion Browser</code> التجريبي أو انتظار دعم Safari 18+ للإضافات.</div></div></div>
          <div class="install-step"><div class="install-step-num">٣</div><div class="install-step-body"><div class="install-step-title">تابلت Windows</div><div class="install-step-desc">يعمل بشكل ممتاز على Chrome أو Edge. اتبع خطوات Chrome بالضبط. الواجهة تتكيف مع الشاشة اللمسية تلقائياً.</div></div></div>
          <div class="install-step"><div class="install-step-num">٤</div><div class="install-step-body"><div class="install-step-title">وضع الشاشة الكاملة</div><div class="install-step-desc">على أي جهاز: اضغط زر "فتح في نافذة منفصلة" لتشغيل لوحة التحكم بملء الشاشة — مريح جداً على التابلت.</div></div></div>
        </div>
        <div class="install-tip">🗒️ <strong>تلميح التابلت:</strong> استخدم وضع الشاشة المقسمة لمتابعة فيسبوك والإضافة في نفس الوقت.</div>
      </div>
    </div>
  </div>
</section>

<!-- ══ FAQ ════════════════════════════════════════════════════════════ -->
<section id="faq">
  <div class="section-inner">
    <div class="fade-in" style="text-align:center;">
      <div class="section-tag">❓ الأسئلة الشائعة</div>
      <h2 class="section-h2">أسئلة <span class="text-accent">يسألها الجميع</span></h2>
      <p class="section-sub" style="margin:0 auto 40px;">لديك سؤال آخر؟ <a href="https://wa.me/201277181217" target="_blank" rel="noopener" style="color:var(--ok);">تواصل معنا عبر واتساب</a></p>
    </div>
    <div class="faq-list fade-in">
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">هل الإضافة مجانية؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">التحميل مجاني 100%. للاستخدام الكامل تحتاج اشتراكاً يبدأ من 99 جنيه شهرياً فقط (~$2). تجربة مجانية 3 أيام عند أول تسجيل دخول.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">هل ستُحظر صفحتي على فيسبوك؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">الإضافة مصممة بـ Stealth Mode متقدم يحاكي السلوك البشري الطبيعي. التأخيرات العشوائية وتنويع النصوص يقلل بشدة احتمال الكشف. لكن أي أداة أتمتة تحمل نسبة خطر — ننصح بالبدء بعدد معتدل من الجروبات وزيادتها تدريجياً.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">كيف أدفع؟ هل يقبل بطاقات بنكية؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">الدفع حالياً عبر فودافون كاش إلى الرقم 01277181217. بعد الدفع أرسل لقطة الشاشة عبر واتساب وسيُفعَّل حسابك خلال دقائق. ندرس إضافة بطاقات بنكية قريباً.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">هل يعمل على iPhone؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">حالياً Safari على iOS لا يدعم الإضافات بشكل كامل. الدعم الأمثل: Chrome على الكمبيوتر وKiwi Browser على أندرويد. نتابع تطور دعم iOS ونحدّث الأداة فور توفره.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">كم جروب يمكنني النشر فيه؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">لا يوجد حد أقصى تقني — يمكنك إضافة 500 جروب وأكثر. لكننا ننصح بـ 50-100 جروب في الجلسة الواحدة مع تأخير 20-45 ثانية بين كل منشور لحماية حسابك.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">هل يحفظ بياناتي أو كلمة المرور؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">لا. الإضافة لا تجمع ولا ترسل أي بيانات شخصية. كل شيء يعمل محلياً في متصفحك فقط. المصادقة تتم عبر خدمة Outseta الموثوقة وليس من خلال خوادمنا مباشرة.</div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">ماذا لو واجهت مشكلة في التثبيت؟ <span class="faq-arrow">⌄</span></button>
        <div class="faq-a">تواصل معنا فوراً عبر واتساب على الرقم 01277181217. فريق الدعم يرد خلال ساعات ويساعدك في التثبيت خطوة بخطوة بالمجان.</div>
      </div>
    </div>
  </div>
</section>

<!-- ══ FINAL CTA ═══════════════════════════════════════════════════════ -->
<section id="final-cta">
  <div class="section-inner">
    <div class="final-cta-inner fade-in">
      <h2 class="final-h2">جاهز للنشر <span class="text-accent">الاحترافي؟</span></h2>
      <p class="final-sub">حمِّل الإضافة الآن مجاناً وابدأ تجربتك المجانية 3 أيام. لا بطاقة بنكية، لا التزامات.</p>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:14px;">
        <a href="login-download.php" class="btn-download-big" style="font-size:16px;padding:18px 40px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          تحميل مجاني الآن
        </a>
        <a href="https://wa.me/201277181217" target="_blank" rel="noopener" class="footer-wa" style="padding:14px 22px;font-size:14px;border-radius:var(--r3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          تواصل معنا
        </a>
      </div>
      <div class="final-trust">
        <span>🔒 تحميل آمن</span>
        <span>✅ بدون فيروسات</span>
        <span>🆓 تجربة 3 أيام مجاناً</span>
        <span>💬 دعم فوري بالعربي</span>
        <span>🔄 تحديثات مجانية</span>
      </div>
    </div>
  </div>
</section>

<!-- ══ FOOTER ═════════════════════════════════════════════════════════ -->
<footer>
  <div class="footer-inner">
    <div>
      <div class="footer-brand-name">fb Bablushr F</div>
      <p class="footer-brand-desc">محرك النشر الاحترافي لمجموعات فيسبوك. مدعوم بـ Gemini و HuggingFace · Stealth Mode · Spintax</p>
      <div style="margin-top:14px;">
        <a href="https://wa.me/201277181217" target="_blank" rel="noopener" class="footer-wa">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          دعم واتساب
        </a>
      </div>
    </div>
    <div>
      <div class="footer-col-title">روابط سريعة</div>
      <ul class="footer-links">
        <li><a href="#features">المميزات الكاملة</a></li>
        <li><a href="#pricing">خطط الأسعار</a></li>
        <li><a href="payment.php">الدفع والتفعيل</a></li>
        <li><a href="login-download.php">تحميل الإضافة</a></li>
        <li><a href="#install">دليل التثبيت</a></li>
        <li><a href="account.php">حسابي</a></li>
        <li><a href="support.php">الدعم</a></li>
        <li><a href="privacy.php">الخصوصية</a></li>
        <li><a href="terms.php">الشروط</a></li>
      </ul>
    </div>
    <div>
      <div class="footer-col-title">المتصفحات المدعومة</div>
      <ul class="footer-links">
        <li><a href="#install">🌐 Google Chrome</a></li>
        <li><a href="#install">🌐 Microsoft Edge</a></li>
        <li><a href="#install">📱 Kiwi Browser (Android)</a></li>
        <li><a href="#install">🍋 Lemur وQuetta</a></li>
        <li><a href="#install">🗒️ تابلت أندرويد/ويندوز</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 fb Bablushr F — جميع الحقوق محفوظة</span>
    <span style="display:flex;align-items:center;gap:8px;">
      <span id="visitorCounter" style="color:var(--p3);font-weight:700;">
        👁 جارٍ التحميل...
      </span>
    </span>
  </div>
</footer>

<!-- ══ GEO WIDGET ════════════════════════════════════════════════════ -->
<div id="geoWidget">
  <button id="geoClose" onclick="document.getElementById('geoWidget').style.display='none'">✕</button>
  <div class="geo-title">زائر جديد 👋</div>
  <div id="geoInfo" style="color:var(--t2);font-size:12px;">جارٍ تحديد الموقع...</div>
</div>

<script>
/* ══════════════════════════════════════════════════════════════════
   THEME TOGGLE
   ══════════════════════════════════════════════════════════════════ */
(function(){
  var btn   = document.getElementById('themeToggleBtn');
  var sun   = document.getElementById('iconSun');
  var moon  = document.getElementById('iconMoon');
  if(!btn) return;
  var isDark = localStorage.getItem('lpTheme') !== 'light';

  function apply(dark){
    document.body.classList.toggle('light-mode', !dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if(sun) sun.style.display  = dark ? 'none'  : 'block';
    if(moon) moon.style.display = dark ? 'block' : 'none';
    btn.setAttribute('aria-label', dark ? 'الوضع الفاتح' : 'الوضع الداكن');
    btn.title = dark ? 'التبديل للوضع الفاتح' : 'التبديل للوضع الداكن';
  }
  apply(isDark);
  btn.addEventListener('click', function(e){
    e.preventDefault();
    isDark = !isDark;
    apply(isDark);
    localStorage.setItem('lpTheme', isDark ? 'dark' : 'light');
  });
})();

/* ══════════════════════════════════════════════════════════════════
   HAMBURGER MENU
   ══════════════════════════════════════════════════════════════════ */
document.getElementById('hamburgerBtn').addEventListener('click', function(){
  document.getElementById('navLinks').classList.toggle('open');
});

/* ══════════════════════════════════════════════════════════════════
   INSTALL TABS
   ══════════════════════════════════════════════════════════════════ */
function switchTab(id){
  ['chrome','kiwi','quetta','lemur','tablet'].forEach(function(t){
    document.getElementById('panel-' + t).classList.toggle('active', t === id);
    document.getElementById('tab-'   + t).classList.toggle('active', t === id);
  });
}

/* ══════════════════════════════════════════════════════════════════
   FAQ ACCORDION
   ══════════════════════════════════════════════════════════════════ */
function toggleFaq(btn){
  var item = btn.closest('.faq-item');
  var isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(function(el){ el.classList.remove('open'); });
  if(!isOpen) item.classList.add('open');
}

/* ══════════════════════════════════════════════════════════════════
   WHATSAPP REDIRECT
   ══════════════════════════════════════════════════════════════════ */
function openWhatsApp(plan){
  var msg = encodeURIComponent('مرحباً! أريد الاشتراك في ' + plan + ' لإضافة fb Bablushr F.');
  window.open('https://wa.me/201277181217?text=' + msg, '_blank');
}

/* ══════════════════════════════════════════════════════════════════
   SCROLL ANIMATIONS (IntersectionObserver)
   ══════════════════════════════════════════════════════════════════ */
(function(){
  if(!('IntersectionObserver' in window)) return;
  var obs = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, {threshold: 0.12});
  document.querySelectorAll('.fade-in').forEach(function(el){ obs.observe(el); });
})();

/* ══════════════════════════════════════════════════════════════════
   GEO TRACKING — ipinfo.io (free, no key for basic fields)
   Tracks: country, city, org — stores in localStorage for dashboard
   ══════════════════════════════════════════════════════════════════ */
(function(){
  var stored = localStorage.getItem('geoShown');

  // Visitor counter (simulated with localStorage persistence)
  var visits = parseInt(localStorage.getItem('totalVisits') || '0') + 1;
  localStorage.setItem('totalVisits', visits);
  var vcEl = document.getElementById('visitorCounter');

  // Fetch geo data
  fetch('https://ipinfo.io/json?token=')
    .then(function(r){ return r.json(); })
    .catch(function(){
      // Fallback: try ip-api (no key needed, CORS ok)
      return fetch('https://ip-api.com/json/?fields=country,countryCode,city,regionName,org,query')
        .then(function(r){ return r.json(); });
    })
    .then(function(data){
      // Normalize fields from both APIs
      var country = data.country || data.countryCode || '??';
      var city    = data.city || '';
      var region  = data.region || data.regionName || '';
      var org     = data.org || '';
      var ip      = data.ip || data.query || '';

      // Flag emoji from country code
      var cc = (data.country_code || data.countryCode || data.country || 'XX').toUpperCase().slice(0,2);
      var flag = cc.replace(/./g, function(c){ return String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0)); });

      // Store geo event in localStorage (array of visits)
      var geoLog = JSON.parse(localStorage.getItem('geoLog') || '[]');
      geoLog.push({
        ts: new Date().toISOString(),
        country: country, city: city, region: region,
        org: org, ip: ip,
        ua: navigator.userAgent.substring(0,80)
      });
      if(geoLog.length > 200) geoLog = geoLog.slice(-200); // keep last 200
      localStorage.setItem('geoLog', JSON.stringify(geoLog));

      // Update counter display
      if(vcEl) vcEl.textContent = '👁 ' + visits + ' زيارة مسجلة · ' + flag + ' ' + (city || country);

      // Show geo widget once per session
      if(!stored && !sessionStorage.getItem('geoShown')){
        sessionStorage.setItem('geoShown', '1');
        var geo = document.getElementById('geoWidget');
        var geoInfo = document.getElementById('geoInfo');
        geoInfo.innerHTML = flag + ' <strong style="color:var(--t1)">' + (city || country) + '</strong>' +
          (region ? ', ' + region : '') + '<br/>' +
          '<span style="color:var(--t3);font-size:10px;">' + (org.replace(/^AS\d+ /,'').substring(0,35)) + '</span>';
        geo.style.display = 'block';
        setTimeout(function(){ geo.style.display = 'none'; }, 8000);
      }

      // Also send to a free analytics endpoint (optional - no-op if blocked)
      try {
        var payload = {
          event:'pageview', ts: new Date().toISOString(),
          country: country, city: city, ref: document.referrer.substring(0,100)
        };
        // Using a free endpoint — replace with your own if needed
        // navigator.sendBeacon('https://your-analytics.com/track', JSON.stringify(payload));
      } catch(e){}
    })
    .catch(function(){
      if(vcEl) vcEl.textContent = '👁 ' + visits + ' زيارة مسجلة';
    });
})();

/* ══════════════════════════════════════════════════════════════════
   DOWNLOAD CLICK TRACKING
   ══════════════════════════════════════════════════════════════════ */
document.querySelectorAll('#navDlBtn,#heroDlBtn,#mainDlBtn,.btn-download-big').forEach(function(btn){
  btn.addEventListener('click', function(){
    var dlLog = JSON.parse(localStorage.getItem('downloadLog') || '[]');
    dlLog.push({ ts: new Date().toISOString(), btn: btn.id || 'unknown' });
    localStorage.setItem('downloadLog', JSON.stringify(dlLog));
    var dlCount = parseInt(localStorage.getItem('downloadCount') || '0') + 1;
    localStorage.setItem('downloadCount', dlCount);
  });
});

/* Smooth nav link close on mobile */
document.querySelectorAll('.nav-links a').forEach(function(a){
  a.addEventListener('click', function(){
    document.getElementById('navLinks').classList.remove('open');
  });
});
</script>


<?php if (file_exists(__DIR__ . '/includes/floating-support.php')) include __DIR__ . '/includes/floating-support.php'; ?>
</body>
</html>
