/* Kiwi/Android fullscreen tab detection — كان inline <script> جوه popup.html
   وده بيتعارض مع CSP (script-src 'self')، فكان بيتفشل بصمت طول الوقت ولا
   يشتغل خالص. اتنقل هنا كملف خارجي منفصل عشان يفضل يتنفذ فورًا (قبل حتى
   تحميل popup.js) ويمنع أي "وميض" بصري وقت التبديل لوضع ملء الشاشة. */
(function () {
  var isWide = window.innerWidth >= 400 || screen.width >= 400;
  var isTall = window.innerHeight >= 640 || screen.height >= 640;
  if (isWide || isTall) {
    document.documentElement.classList.add('fullscreen-tab');
    document.body.classList.add('fullscreen-tab', 'kiwi-fullscreen');
  }
  // Re-check after small delay (some browsers report wrong initial size)
  setTimeout(function () {
    if (window.innerWidth >= 400 || window.innerHeight >= 640) {
      document.documentElement.classList.add('fullscreen-tab');
      document.body.classList.add('fullscreen-tab', 'kiwi-fullscreen');
    }
  }, 50);
})();
