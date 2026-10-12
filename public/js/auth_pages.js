/* Handles the login, register and account pages */
(function () {
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; }); });
  }
  function safeNext() {
    var n = new URLSearchParams(window.location.search).get('next');
    return (n && n.charAt(0) === '/' && n.charAt(1) !== '/' && n.indexOf('\\') === -1) ? n : 'account.html';
  }
  var form = document.getElementById('auth_form');
  if (form) {
    var mode = form.getAttribute('data-mode');
    var msg = document.getElementById('auth_msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.style.display = 'none';
      var btn = form.querySelector('button');
      btn.disabled = true;
      var body = { email: form.email.value, password: form.password.value };
      if (mode === 'register') body.name = form.name.value;
      post('/api/' + mode, body).then(function (res) {
        if (res.ok) { window.location.href = safeNext(); return; }
        msg.textContent = res.data.error || 'Something went wrong. Please try again.';
        msg.style.display = 'block';
        btn.disabled = false;
      }).catch(function () {
        msg.textContent = 'Could not reach the server.';
        msg.style.display = 'block';
        btn.disabled = false;
      });
    });
  }
  var account = document.getElementById('account_info');
  if (account) {
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) { window.location.href = 'login.html'; return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      document.getElementById('acc_name').textContent = d.user.name;
      document.getElementById('acc_email').textContent = d.user.email;
      document.getElementById('acc_since').textContent = new Date(d.user.createdAt).toLocaleDateString();
      document.getElementById('acc_welcome').textContent = 'Welcome, ' + d.user.name + '!';
    });
    document.getElementById('logout_btn').addEventListener('click', function () {
      post('/api/logout', {}).then(function () { window.location.href = 'index.html'; });
    });
  }
})();
