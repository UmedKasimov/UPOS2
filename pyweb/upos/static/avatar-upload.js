(function () {
  function t(key, fallback, vars) {
    const pack = window.upos_i18n || {};
    let text = pack[key] || fallback || key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((name) => {
        text = String(text).replace(new RegExp('\\{' + name + '\\}', 'g'), String(vars[name]));
      });
    }
    return text;
  }

  const trigger = document.getElementById('sidebar-avatar-trigger');
  const input = document.getElementById('sidebar-avatar-input');
  if (!trigger || !input) return;

  trigger.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    // Optional: client side size check
    if (file.size > 10 * 1024 * 1024) {
      alert(t('avatar.err.too_large', 'Файл слишком большой (макс 10МБ)'));
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    // Show loading state
    const originalContent = trigger.innerHTML;
    trigger.style.opacity = '0.5';
    trigger.style.pointerEvents = 'none';

    try {
      const res = await fetch('/api/user/avatar', {
        method: 'POST',
        headers: {
          // 'X-CSRF-Token': ... // If needed, but session cookies usually enough for same-site
        },
        body: formData
      });
      const body = await res.json();
      if (body.ok) {
        location.reload();
      } else {
        alert(t('avatar.err.upload', 'Ошибка при загрузке: {error}', { error: body.error || t('avatar.err.unknown', 'неизвестно') }));
        trigger.innerHTML = originalContent;
        trigger.style.opacity = '';
        trigger.style.pointerEvents = '';
      }
    } catch (e) {
      alert(t('avatar.err.network', 'Ошибка сети или сервера'));
      trigger.innerHTML = originalContent;
      trigger.style.opacity = '';
      trigger.style.pointerEvents = '';
    }
  });
})();
