/* Adds Login / Register (or Account / Logout) to the site menus. Does nothing if there is no back end. */
(function () {
  function addAfter(li, items) {
    var prev = li;
    items.forEach(function (it) {
      var n = document.createElement('li');
      n.className = li.className;
      var a = document.createElement('a');
      a.href = it.href; a.textContent = it.text;
      if (it.onclick) a.addEventListener('click', it.onclick);
      n.appendChild(a);
      prev.parentNode.insertBefore(n, prev.nextSibling);
      prev = n;
    });
  }
  function logout(e) {
    e.preventDefault();
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function () { window.location.href = 'index.html'; });
  }
  function setupProfileIcon(user) {
    var holder = document.querySelector('.user');
    var link = holder && holder.querySelector('a');
    if (!link) return;
    if (!user) { link.href = 'login.html'; link.title = 'Log in or register'; return; }

    var css = document.createElement('style');
    css.textContent =
      '.user{position:relative}' +
      '.user_menu{display:none;position:absolute;right:0;top:50px;width:240px;background:#fff;text-align:left;z-index:1200;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.18);padding:16px 18px;font-family:Poppins,sans-serif}' +
      '.user_menu.open{display:block}' +
      '.user_menu b{display:block;font-size:15px;color:#232323;word-break:break-word}' +
      '.user_menu small{display:block;font-size:13px;color:#777;margin:2px 0 12px;word-break:break-word}' +
      '.user_menu a{display:block;padding:7px 0;font-size:14px;color:#2e21df;border-top:1px solid #eee}' +
      '.user_menu a:hover{color:#000}';
    document.head.appendChild(css);

    var menu = document.createElement('div');
    menu.className = 'user_menu';
    var nm = document.createElement('b'); nm.textContent = user.name;
    var em = document.createElement('small'); em.textContent = user.email;
    var acc = document.createElement('a'); acc.href = 'account.html'; acc.textContent = 'My account';
    var out = document.createElement('a'); out.href = '#'; out.textContent = 'Log out';
    out.addEventListener('click', logout);
    menu.appendChild(nm); menu.appendChild(em); menu.appendChild(acc); menu.appendChild(out);
    holder.appendChild(menu);

    link.href = '#'; link.title = user.name;
    link.addEventListener('click', function (e) { e.preventDefault(); menu.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!holder.contains(e.target)) menu.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu.classList.remove('open'); });
  }
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
    if (r.ok) return r.json();
    if (r.status === 401) return { user: null };
    return undefined; // no back end here (e.g. static hosting)
  }).then(function (data) {
    if (!data) return;
    setupProfileIcon(data.user);
    var items = data.user
      ? [{ href: 'account.html', text: 'Account' }, { href: '#', text: 'Logout', onclick: logout }]
      : [{ href: 'login.html', text: 'Login' }, { href: 'register.html', text: 'Register' }];
    var links = document.querySelectorAll('a[href="contact.html"]');
    Array.prototype.forEach.call(links, function (a) {
      var li = a.parentNode;
      if (li && li.tagName === 'LI') addAfter(li, items);
    });
  }).catch(function () {});
})();
