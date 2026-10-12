/* Course progress: saved in the browser, separately for each logged-in user (or "guest") and course */
(function () {
  var root = document.getElementById('lesson_root') || document.getElementById('overview_root');
  if (!root) return;
  var course = root.getAttribute('data-course');
  var total = parseInt(root.getAttribute('data-total'), 10);
  var lesson = parseInt(root.getAttribute('data-lesson') || '0', 10);
  var key = '', done = [];

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      done = Array.isArray(v) ? v.filter(function (n) { return n >= 1 && n <= total; }) : [];
    } catch (e) { done = []; }
  }
  function save() { try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }

  function render() {
    var pct = Math.round(done.length / total * 100);
    $('lp_fill').style.width = pct + '%';
    $('lp_pct').textContent = pct + '%';
    $('lp_bar').setAttribute('aria-valuenow', pct);
    $('lp_status').textContent = lesson
      ? 'Lesson ' + lesson + ' of ' + total + ' - ' + done.length + ' of ' + total + ' lessons completed'
      : done.length + ' of ' + total + ' lessons completed';

    if (lesson) {
      var isDone = done.indexOf(lesson) !== -1;
      $('lesson_done').style.display = isDone ? 'inline-block' : 'none';
    } else {
      var items = document.querySelectorAll('.ov_item');
      Array.prototype.forEach.call(items, function (el) {
        var n = parseInt(el.getAttribute('data-lesson'), 10);
        el.classList.toggle('done', done.indexOf(n) !== -1);
      });
      var next = 1;
      while (next <= total && done.indexOf(next) !== -1) next++;
      var btn = $('continue_btn');
      if (next > total) { btn.textContent = 'Review lesson 1 \u2192'; btn.href = course + '_1.html'; }
      else {
        btn.href = course + '_' + next + '.html';
        btn.textContent = (done.length ? 'Continue with lesson ' + next : 'Start course') + ' \u2192';
      }
      $('finished_msg').style.display = done.length === total ? 'block' : 'none';
    }
  }

  function init(email) {
    key = 'fl_progress:' + (email || 'guest') + ':' + course;
    load();
    render();
    var cb = $('complete_btn');
    if (cb) cb.addEventListener('click', function () {
      if (done.indexOf(lesson) === -1) done.push(lesson);
      save(); render();
      cb.disabled = true;
      var target = root.getAttribute('data-next');
      setTimeout(function () { window.location.href = target; }, 700); // let the bar animate first
    });
    var rb = $('reset_btn');
    if (rb) rb.addEventListener('click', function () {
      if (window.confirm('Reset your progress in this course?')) { done = []; save(); render(); }
    });
  }

  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { init(d && d.user ? d.user.email : null); })
    .catch(function () { init(null); });
})();
