/* مزامنة ثيم الموقع من السيرفر — لا يمس منطق النشر */
  (function(){
    var API = 'https://faset.xo.je/api/theme.php';
    try {
      fetch(API + '?_=' + Date.now(), { credentials: 'omit' })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(!d || !d.ok || !d.apply_extension || !d.vars) return;
          var root = document.documentElement;
          Object.keys(d.vars).forEach(function(k){
            try { root.style.setProperty(k, d.vars[k]); } catch(e){}
          });
          if(d.vars['--bg']) document.body.style.backgroundColor = d.vars['--bg'];
          if(d.vars['--p1']) {
            root.style.setProperty('--p1', d.vars['--p1']);
            root.style.setProperty('--p2', d.vars['--p2'] || d.vars['--p1']);
            root.style.setProperty('--p3', d.vars['--p3'] || d.vars['--p2']);
          }
          if(d.radius) root.style.setProperty('--radius', d.radius);
          if(d.radius) root.style.setProperty('--radius-sm', Math.max(8, parseInt(d.radius,10)-2) + 'px');
        }).catch(function(){});
    } catch(e){}
  })();
