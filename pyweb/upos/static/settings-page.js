(function () {
  function t(key) {
    var pack = window.upos_i18n || null;
    if (!pack || !pack[key]) return key;
    return pack[key];
  }

  function tf(key, n) {
    return String(t(key)).replace(/\{n\}/g, String(n));
  }

  function isJunkToken(value) {
    var v = (value || "").trim();
    if (!v) return false;
    var lower = v.toLowerCase();
    return lower === "test" || lower === "тест";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initTokenAntiAutofill(input) {
    if (!input) return;

    function runScrub() {
      if (isJunkToken(input.value)) input.value = "";
    }

    input.addEventListener("focus", function () {
      input.removeAttribute("readonly");
    });

    runScrub();
    requestAnimationFrame(runScrub);
    setTimeout(runScrub, 0);
    setTimeout(runScrub, 50);
    setTimeout(runScrub, 200);
    setTimeout(runScrub, 700);
    setTimeout(runScrub, 2000);

    input.addEventListener("input", runScrub);
    input.addEventListener("change", runScrub);
  }

  function csrfToken() {
    var el = document.querySelector('input[name="csrf_token"]');
    return el ? el.value || "" : "";
  }

  function setGreenWhiteStatus(message, variant, root) {
    var scope = root || document;
    var el = scope.querySelector("[data-greenwhite-status]");
    if (!el) return;
    el.textContent = message || "";
    if (variant) el.setAttribute("data-variant", variant);
    else el.removeAttribute("data-variant");
  }

  function initGreenWhiteActions(root) {
    var scope = root || document;
    var btnTest = scope.querySelector("[data-greenwhite-test]");
    var btnSync = scope.querySelector("[data-greenwhite-sync]");

    function call(endpoint, loadingText, okText) {
      setGreenWhiteStatus(loadingText, "", scope);
      return fetch(endpoint, {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken() },
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (body) {
            if (!res.ok) throw new Error(body.error || t("settings.js.req_err"));
            return body;
          });
        })
        .then(function (body) {
          var count = body.status && body.status.imported_count;
          var msg = count != null ? okText + ". " + tf("settings.js.imported", count) : okText;
          setGreenWhiteStatus(msg, "ok", scope);
        })
        .catch(function (err) {
          setGreenWhiteStatus(err.message || t("settings.js.smartup_err"), "err", scope);
        });
    }

    if (btnTest) {
      btnTest.addEventListener("click", function () {
        call("/api/integrations/greenwhite/test", t("settings.js.gw_testing"), t("settings.js.gw_ok"));
      });
    }
    if (btnSync) {
      btnSync.addEventListener("click", function () {
        call("/api/integrations/greenwhite/sync", t("settings.js.gw_syncing"), t("settings.js.gw_sync_done"));
      });
    }
  }

  function initLanguageDropdowns() {
    document.querySelectorAll("[data-lang-dropdown]").forEach(function (root) {
      var trigger = root.querySelector("[data-lang-trigger]");
      var menu = root.querySelector("[data-lang-menu]");
      var input = root.querySelector("[data-lang-input]");
      var current = root.querySelector("[data-lang-current]");
      var currentFlag = root.querySelector("[data-lang-current-flag]");
      var options = Array.prototype.slice.call(root.querySelectorAll("[data-lang-option]"));
      if (!trigger || !menu || !input || !current || !currentFlag || !options.length) return;

      function close() {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      }

      function open() {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      }

      function selectOption(option, refocus) {
        var prev = input.value;
        var value = option.getAttribute("data-value") || "";
        var label = option.getAttribute("data-label") || option.textContent || "";
        var flagClass = option.getAttribute("data-flag-class") || "";
        input.value = value;
        current.textContent = label;
        currentFlag.className = ("settings-flag " + flagClass).trim();
        options.forEach(function (item) {
          item.setAttribute("aria-selected", item === option ? "true" : "false");
        });
        close();
        if (refocus) trigger.focus();
        if (value && value !== prev) {
          document.dispatchEvent(
            new CustomEvent("upos:locale-change", { detail: { locale: value } })
          );
        }
      }

      function focusOption(delta) {
        var active = document.activeElement;
        var index = options.indexOf(active);
        if (index < 0) {
          index = options.findIndex(function (item) {
            return item.getAttribute("aria-selected") === "true";
          });
        }
        var next = options[(index + delta + options.length) % options.length] || options[0];
        next.focus();
      }

      trigger.addEventListener("click", function () {
        if (menu.hidden) open();
        else close();
      });

      trigger.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
          focusOption(1);
        }
        if (ev.key === "Escape") close();
      });

      options.forEach(function (option) {
        option.addEventListener("click", function () {
          selectOption(option, true);
        });
        option.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            selectOption(option, true);
          } else if (ev.key === "ArrowDown") {
            ev.preventDefault();
            focusOption(1);
          } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            focusOption(-1);
          } else if (ev.key === "Escape") {
            close();
            trigger.focus();
          }
        });
      });

      document.addEventListener("click", function (ev) {
        if (!root.contains(ev.target)) close();
      });
    });
  }

  var EMAIL_RE =
    /^[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  function emailValid(value) {
    var s = (value || "").trim();
    return !!(s && EMAIL_RE.test(s));
  }

  var prefToastTimer = null;

  function showPrefToast() {
    var toast = document.querySelector("[data-settings-pref-toast]");
    if (!toast) return;
    toast.textContent = t("settings.prefs_saved");
    clearTimeout(prefToastTimer);
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    prefToastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2000);
  }

  function savePreferences(patch) {
    return fetch("/api/settings/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken(),
      },
      body: JSON.stringify(patch || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.save_err"));
        return body;
      });
    });
  }

  function initPreferencesAutoSave() {
    var panel = document.querySelector("[data-settings-general]");
    if (!panel) return;

    panel.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        var theme = radio.value;
        if (window.uposTheme) window.uposTheme(theme);
        if (document.body) document.body.dataset.theme = theme;
        savePreferences({ theme: theme })
          .then(function () {
            showPrefToast();
          })
          .catch(function (err) {
            alert(err.message || t("settings.js.save_err"));
          });
      });
    });

    var tz = document.getElementById("workspace_timezone");
    if (tz) {
      var tzInit = tz.value;
      tz.addEventListener("change", function () {
        if (tz.value === tzInit) return;
        savePreferences({ timezone: tz.value })
          .then(function () {
            tzInit = tz.value;
            showPrefToast();
          })
          .catch(function (err) {
            alert(err.message || t("settings.js.save_err"));
          });
      });
    }

    document.addEventListener("upos:locale-change", function (ev) {
      var locale = ev.detail && ev.detail.locale;
      if (!locale) return;
      savePreferences({ locale: locale })
        .then(function (body) {
          showPrefToast();
          if (body.reload) {
            setTimeout(function () {
              window.location.reload();
            }, 700);
          }
        })
        .catch(function (err) {
          alert(err.message || t("settings.js.save_err"));
        });
    });
  }

  function fieldVal(id) {
    var el = document.getElementById(id);
    return el ? (el.value || "").trim() : "";
  }

  function collectIntegrationPayload(key) {
    var gwEnabled = document.getElementById("greenwhite_sync_enabled");
    var integrations = {};
    if (key === "onec") {
      integrations.onec = {
        base_url: fieldVal("onec_base_url"),
        username: fieldVal("onec_username"),
        password: fieldVal("onec_password"),
      };
    } else if (key === "yespos") {
      integrations.yespos = {
        api_base_url: fieldVal("yespos_api_base_url"),
        api_key: fieldVal("yespos_api_key"),
      };
    } else if (key === "ibox") {
      integrations.ibox = {
        api_url: fieldVal("ibox_api_url"),
        api_key: fieldVal("ibox_api_key"),
        terminal_id: fieldVal("ibox_terminal_id"),
      };
    } else if (key === "clopos") {
      integrations.clopos = {
        api_base_url: fieldVal("clopos_api_base_url"),
        client_id: fieldVal("clopos_client_id"),
        client_secret: fieldVal("clopos_client_secret"),
        brand: fieldVal("clopos_brand"),
        integrator_id: fieldVal("clopos_integrator_id"),
        venue_id: fieldVal("clopos_venue_id"),
      };
    } else if (key === "greenwhite") {
      integrations.greenwhite = {
        base_url: fieldVal("greenwhite_base_url"),
        username: fieldVal("greenwhite_username"),
        password: fieldVal("greenwhite_password"),
        project_code: fieldVal("greenwhite_project_code") || "trade",
        filial_id: fieldVal("greenwhite_filial_id"),
        filial_code: fieldVal("greenwhite_filial_code"),
        sync_days: parseInt(fieldVal("greenwhite_sync_days") || "7", 10) || 7,
        sync_enabled: !!(gwEnabled && gwEnabled.checked),
      };
    }
    return { integrations: integrations };
  }

  function updateIntegrStatusPill(key, conn) {
    var pill = document.querySelector('[data-integr-status="' + key + '"]');
    if (!pill || !conn) return;
    pill.hidden = false;
    if (conn.ok) {
      pill.setAttribute("data-variant", "ok");
      pill.textContent = conn.message || t("settings.integrations.connected");
    } else {
      pill.setAttribute("data-variant", "err");
      pill.textContent =
        conn.message ||
        (key === "greenwhite"
          ? t("settings.integrations.not_connected")
          : t("settings.integrations.not_configured"));
    }
  }

  function initIntegrationModals() {
    var dialog = document.getElementById("settings-integr-dialog");
    if (!dialog) return;
    var activeKey = "";
    var titleEl = dialog.querySelector("[data-integr-modal-title]");
    var logoEl = dialog.querySelector("[data-integr-modal-logo]");
    var saveBtn = dialog.querySelector("[data-integr-save]");
    var forms = Array.prototype.slice.call(dialog.querySelectorAll("[data-integr-form]"));

    function showForm(key) {
      forms.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-integr-form") !== key;
      });
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      activeKey = "";
    }

    function openDialog(key, triggerBtn) {
      activeKey = key;
      showForm(key);
      if (triggerBtn) {
        var rowLogo = triggerBtn.querySelector(".integr-card-logo");
        var rowTitle = triggerBtn.querySelector(".integr-card-title");
        if (logoEl && rowLogo) {
          logoEl.src = rowLogo.getAttribute("src") || "";
          logoEl.className = rowLogo.className + " integr-card-logo--modal";
          logoEl.hidden = false;
        } else if (logoEl) {
          logoEl.hidden = true;
        }
        if (titleEl) {
          titleEl.textContent =
            (rowTitle && rowTitle.textContent) ||
            triggerBtn.getAttribute("aria-label") ||
            key;
        }
      }
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "open");
      var firstInput = dialog.querySelector('[data-integr-form="' + key + '"] input:not([type="checkbox"])');
      if (firstInput) firstInput.focus();
    }

    document.querySelectorAll("[data-integr-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDialog(btn.getAttribute("data-integr-open") || "", btn);
      });
    });

    dialog.querySelectorAll("[data-integr-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) closeDialog();
    });

    initGreenWhiteActions(dialog);

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (!activeKey) return;
        saveBtn.disabled = true;
        var saveLabel = saveBtn.textContent;
        if (activeKey === "greenwhite" || activeKey === "clopos") {
          saveBtn.textContent = t("settings.integrations.testing");
        }
        fetch("/api/settings/integrations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken(),
          },
          body: JSON.stringify(collectIntegrationPayload(activeKey)),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.save_err"));
              return body;
            });
          })
          .then(function (body) {
            if (body.connection) updateIntegrStatusPill(activeKey, body.connection);
            closeDialog();
            showPrefToast();
          })
          .catch(function (err) {
            alert(err.message || t("settings.js.save_err"));
          })
          .finally(function () {
            saveBtn.disabled = false;
            saveBtn.textContent = saveLabel || t("settings.integrations.save_modal");
          });
      });
    }
  }

  function initSocialSettings() {
    var panel = document.querySelector("[data-settings-social]");
    if (!panel) return;
    var saveBtn = panel.querySelector("[data-social-save]");
    var status = panel.querySelector("[data-social-status]");
    if (!saveBtn) return;

    function setStatus(message, variant) {
      if (!status) return;
      status.hidden = !message;
      status.textContent = message || "";
      if (variant) status.setAttribute("data-variant", variant);
      else status.removeAttribute("data-variant");
    }

    function collect() {
      var out = {};
      panel.querySelectorAll("[data-social-field]").forEach(function (field) {
        var key = field.getAttribute("data-social-field") || "";
        if (!key) return;
        if (field.type === "checkbox") {
          out[key] = field.checked ? "1" : "";
        } else {
          out[key] = (field.value || "").trim();
        }
      });
      return out;
    }

    saveBtn.addEventListener("click", function () {
      var originalLabel = saveBtn.textContent;
      saveBtn.disabled = true;
      setStatus("Сохраняем...", "");
      fetch("/api/settings/social-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken(),
        },
        body: JSON.stringify({ social_links: collect() }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.save_err"));
            return body;
          });
        })
        .then(function () {
          setStatus("Соцсети сохранены", "ok");
          showPrefToast();
        })
        .catch(function (err) {
          setStatus(err.message || t("settings.js.save_err"), "err");
        })
        .finally(function () {
          saveBtn.disabled = false;
          saveBtn.textContent = originalLabel;
        });
    });
  }

  function initSocialTelegramIntegration() {
    var root = document.querySelector("[data-social-telegram]");
    if (!root) return;
    var tokenInput = root.querySelector("[data-social-tg-token]");
    var statusEl = root.querySelector("[data-social-tg-status]");
    var botEl = root.querySelector("[data-social-tg-bot]");
    var countEl = root.querySelector("[data-social-tg-chat-count]");
    var connectBtn = root.querySelector("[data-social-tg-connect]");
    var refreshBtn = root.querySelector("[data-social-tg-refresh]");
    var disconnectBtn = root.querySelector("[data-social-tg-disconnect]");

    function setStatus(message, variant) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      if (variant) statusEl.setAttribute("data-variant", variant);
      else statusEl.removeAttribute("data-variant");
    }

    function setBusy(btn, busy, text) {
      if (!btn) return;
      if (busy) {
        btn.dataset.originalText = btn.textContent || "";
        btn.textContent = text || "Загрузка...";
      } else if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
      }
      btn.disabled = !!busy;
    }

    function call(method, url, body) {
      var headers = { "X-CSRF-Token": csrfToken() };
      var opts = { method: method, headers: headers };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body || {});
      }
      return fetch(url, opts).then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            if (!res.ok || payload.error) throw new Error(payload.error || t("settings.js.save_err"));
            return payload;
          });
      });
    }

    function renderStatus(payload) {
      var cfg = payload.config || {};
      var connected = !!payload.connected;
      if (botEl) {
        botEl.textContent = connected
          ? (cfg.bot_username ? "@" + cfg.bot_username : cfg.bot_first_name || "Telegram бот")
          : "Бот не подключен";
      }
      if (countEl) {
        countEl.textContent =
          "Чатов: " +
          String(payload.admin_chats_count || 0) +
          ", активных: " +
          String(payload.enabled_chats_count || 0);
      }
      if (refreshBtn) refreshBtn.disabled = !connected || !payload.can_manage;
      if (disconnectBtn) disconnectBtn.disabled = !connected || !payload.can_manage;
      if (connectBtn) connectBtn.disabled = !payload.can_manage;
      if (!connected) {
        setStatus("Не подключен. Вставьте токен BotFather и нажмите подключить.", "warn");
      } else if (cfg.last_error) {
        setStatus(cfg.last_error, "warn");
      } else {
        setStatus("Telegram подключен и готов к работе.", "ok");
      }
    }

    function loadStatus() {
      return call("GET", "/api/telegram/status?webhook=1")
        .then(renderStatus)
        .catch(function (err) {
          setStatus(err.message || "Не удалось проверить Telegram", "err");
        });
    }

    if (connectBtn) {
      connectBtn.addEventListener("click", function () {
        var token = tokenInput ? (tokenInput.value || "").trim() : "";
        if (!token) {
          if (tokenInput) tokenInput.focus();
          setStatus("Укажите токен Telegram-бота.", "warn");
          return;
        }
        setBusy(connectBtn, true, "Подключаем...");
        call("POST", "/api/telegram/verify", { token: token })
          .then(function () {
            if (tokenInput) tokenInput.value = "";
            return loadStatus();
          })
          .then(function () {
            showPrefToast();
          })
          .catch(function (err) {
            setStatus(err.message || "Telegram не подключен", "err");
          })
          .finally(function () {
            setBusy(connectBtn, false);
          });
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        setBusy(refreshBtn, true, "Обновляем...");
        call("POST", "/api/telegram/chats/refresh")
          .then(loadStatus)
          .catch(function (err) {
            setStatus(err.message || "Не удалось обновить чаты", "err");
          })
          .finally(function () {
            setBusy(refreshBtn, false);
          });
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", function () {
        if (!confirm("Отключить Telegram-бота от программы?")) return;
        setBusy(disconnectBtn, true, "Отключаем...");
        call("DELETE", "/api/telegram/disconnect")
          .then(loadStatus)
          .catch(function (err) {
            setStatus(err.message || "Не удалось отключить Telegram", "err");
          })
          .finally(function () {
            setBusy(disconnectBtn, false);
          });
      });
    }

    loadStatus();
  }

  var PW_RULES = [
    {
      key: "settings.profile.pw_tip.length",
      test: function (pw) {
        return pw.length >= 8;
      },
    },
    {
      key: "settings.profile.pw_tip.lower",
      test: function (pw) {
        return /[a-z]/.test(pw);
      },
    },
    {
      key: "settings.profile.pw_tip.upper",
      test: function (pw) {
        return /[A-Z]/.test(pw);
      },
    },
    {
      key: "settings.profile.pw_tip.digit",
      test: function (pw) {
        return /\d/.test(pw);
      },
    },
    {
      key: "settings.profile.pw_tip.symbol",
      test: function (pw) {
        return /[^a-zA-Z0-9]/.test(pw);
      },
    },
  ];

  function analyzePassword(pw) {
    var score = 0;
    var rules = PW_RULES.map(function (rule) {
      var met = rule.test(pw);
      if (met) score += 1;
      return { key: rule.key, met: met };
    });
    var level = "weak";
    if (pw.length >= 8 && score >= 5) level = "strong";
    else if (pw.length >= 8 && score >= 4) level = "good";
    else if (pw.length >= 6 && score >= 3) level = "fair";
    return {
      score: score,
      level: level,
      rules: rules,
      short: pw.length > 0 && pw.length < 8,
    };
  }

  function initProfileEditor() {
    var dialog = document.getElementById("settings-profile-dialog");
    var openBtn = document.querySelector("[data-settings-profile-open]");
    if (!dialog || !openBtn) return;

    var summary = document.querySelector("[data-settings-account-summary]");
    var formError = dialog.querySelector("[data-profile-form-error]");
    var emailErr = dialog.querySelector("[data-profile-email-error]");
    var pwMismatch = dialog.querySelector("[data-profile-pw-mismatch]");
    var pwStrength = dialog.querySelector("[data-profile-pw-strength]");
    var pwBar = dialog.querySelector("[data-profile-pw-bar]");
    var pwLabel = dialog.querySelector("[data-profile-pw-label]");
    var pwChecklist = dialog.querySelector("[data-profile-pw-checklist]");
    var saveBtn = dialog.querySelector("[data-settings-profile-save]");
    var loginInput = dialog.querySelector("[data-profile-field='username']");
    var emailInput = dialog.querySelector("[data-profile-field='email']");
    var nameInput = dialog.querySelector("[data-profile-field='name']");
    var curPw = dialog.querySelector("[data-profile-field='current_password']");
    var newPw = dialog.querySelector("[data-profile-field='new_password']");
    var confirmPw = dialog.querySelector("[data-profile-field='new_password_confirm']");

    function setHidden(el, hidden) {
      if (!el) return;
      el.hidden = hidden;
    }

    function resetFormFromSummary() {
      if (!summary) return;
      if (loginInput) loginInput.value = summary.getAttribute("data-profile-username") || "";
      if (emailInput) emailInput.value = summary.getAttribute("data-profile-email") || "";
      if (nameInput) nameInput.value = summary.getAttribute("data-profile-name") || "";
      if (curPw) curPw.value = "";
      if (newPw) newPw.value = "";
      if (confirmPw) confirmPw.value = "";
      setHidden(formError, true);
      setHidden(emailErr, true);
      setHidden(pwMismatch, true);
      if (pwStrength) pwStrength.hidden = true;
    }

    function updateSummary(profile) {
      if (!summary || !profile) return;
      summary.setAttribute("data-profile-username", profile.username || "");
      summary.setAttribute("data-profile-email", profile.email || "");
      summary.setAttribute("data-profile-name", profile.name || "");
      summary.querySelectorAll("[data-profile-summary]").forEach(function (el) {
        var key = el.getAttribute("data-profile-summary");
        if (key && profile[key] != null) el.textContent = profile[key];
      });
      var av = summary.querySelector("[data-profile-avatar]");
      if (av) {
        var disp = (profile.name || profile.username || "?").trim();
        av.textContent = disp ? disp.charAt(0).toUpperCase() : "?";
      }
    }

    function renderPwStrength() {
      var pw = newPw ? newPw.value || "" : "";
      if (!pw) {
        if (pwStrength) pwStrength.hidden = true;
        return;
      }
      var info = analyzePassword(pw);
      if (pwStrength) pwStrength.hidden = false;
      if (pwBar) {
        var pct = info.short ? 12 : Math.min(100, 16 + info.score * 17);
        pwBar.style.width = pct + "%";
        pwBar.setAttribute("data-level", info.level);
      }
      if (pwLabel) pwLabel.textContent = t("settings.profile.pw_strength." + info.level);
      if (pwChecklist) {
        pwChecklist.innerHTML = "";
        info.rules.forEach(function (rule) {
          var li = document.createElement("li");
          li.className = "settings-pw-check " + (rule.met ? "is-met" : "is-pending");
          var ic = document.createElement("span");
          ic.className = "settings-pw-check-ic";
          ic.setAttribute("aria-hidden", "true");
          var text = document.createElement("span");
          text.className = "settings-pw-check-text";
          text.textContent = t(rule.key);
          li.appendChild(ic);
          li.appendChild(text);
          pwChecklist.appendChild(li);
        });
      }
    }

    function validateEmailLive() {
      if (!emailInput || !emailErr) return true;
      var ok = emailValid(emailInput.value);
      emailErr.textContent = ok ? "" : t("settings.profile.err_email_invalid");
      emailErr.hidden = ok;
      return ok;
    }

    function validateConfirmLive() {
      if (!newPw || !confirmPw || !pwMismatch) return true;
      var a = newPw.value || "";
      var b = confirmPw.value || "";
      if (!a && !b) {
        pwMismatch.hidden = true;
        return true;
      }
      var ok = a === b;
      pwMismatch.textContent = t("settings.profile.err_pw_mismatch");
      pwMismatch.hidden = ok;
      return ok;
    }

    function openDialog() {
      resetFormFromSummary();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "open");
      if (curPw) curPw.focus();
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    }

    openBtn.addEventListener("click", openDialog);
    dialog.querySelectorAll("[data-settings-profile-close]").forEach(function (btn) {
      btn.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) closeDialog();
    });

    if (emailInput) emailInput.addEventListener("input", validateEmailLive);
    if (newPw) {
      newPw.addEventListener("input", function () {
        renderPwStrength();
        validateConfirmLive();
      });
    }
    if (confirmPw) confirmPw.addEventListener("input", validateConfirmLive);

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        setHidden(formError, true);
        var username = (loginInput && loginInput.value ? loginInput.value : "").trim();
        var email = (emailInput && emailInput.value ? emailInput.value : "").trim();
        var name = (nameInput && nameInput.value ? nameInput.value : "").trim();
        var npw = newPw ? newPw.value || "" : "";
        var npwC = confirmPw ? confirmPw.value || "" : "";
        if (!username) {
          if (formError) {
            formError.textContent = t("settings.profile.err_login_required");
            formError.hidden = false;
          }
          return;
        }
        if (!validateEmailLive()) return;
        if (npw || npwC) {
          if (npw.length < 8) {
            renderPwStrength();
            if (formError) {
              formError.textContent = t("settings.profile.err_pw_short");
              formError.hidden = false;
            }
            if (newPw) newPw.focus();
            return;
          }
          if (!validateConfirmLive()) return;
        }
        saveBtn.disabled = true;
        fetch("/api/auth/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken(),
          },
          body: JSON.stringify({
            username: username,
            email: email,
            name: name,
            current_password: curPw ? curPw.value || "" : "",
            new_password: npw,
            new_password_confirm: npwC,
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.save_err"));
              return body;
            });
          })
          .then(function (body) {
            updateSummary(body.profile);
            closeDialog();
            showPrefToast();
          })
          .catch(function (err) {
            if (formError) {
              formError.textContent = err.message || t("settings.js.save_err");
              formError.hidden = false;
            }
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });
    }
  }

  function initCurrencyVisibility() {
    var meta = window.UPOS_CCY || null;
    var dialog = document.getElementById("settings-ccy-dialog");
    var chipsRoot = document.querySelector("[data-ccy-active-chips]");
    var openBtn = document.querySelector("[data-ccy-edit-open]");
    var saveBtn = dialog ? dialog.querySelector("[data-ccy-save]") : null;
    var grid = dialog ? dialog.querySelector("[data-ccy-grid]") : null;
    var addInput = dialog ? dialog.querySelector("[data-ccy-add-input]") : null;
    var addBtn = dialog ? dialog.querySelector("[data-ccy-add-btn]") : null;
    var addStatus = dialog ? dialog.querySelector("[data-ccy-add-status]") : null;
    if (!dialog || !chipsRoot) return;

    function decorateCcyNodes(root) {
      root.querySelectorAll("[data-ccy-symbol]").forEach(function (el) {
        var code = el.getAttribute("data-ccy-symbol") || "";
        var symbol = meta && meta.symbol ? meta.symbol(code) : "";
        el.textContent = symbol;
      });
      root.querySelectorAll("[data-ccy-icon]").forEach(function (el) {
        var code = el.getAttribute("data-ccy-icon") || "";
        if (meta && meta.iconHtmlSmall) el.innerHTML = meta.iconHtmlSmall(code);
        else el.textContent = code.slice(0, 2);
      });
    }

    decorateCcyNodes(dialog);

    function currentBoxes() {
      return Array.prototype.slice.call(dialog.querySelectorAll('input[name="enabled_currencies"]'));
    }

    function currentAvailableCodes() {
      return Array.prototype.slice
        .call(dialog.querySelectorAll("[data-ccy-available]"))
        .map(function (input) { return normalizeCcyCode(input.value); })
        .filter(Boolean);
    }

    function normalizeCcyCode(value) {
      var code = String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
      return code.length === 3 ? code : "";
    }

    function setAddStatus(message, variant) {
      if (!addStatus) return;
      addStatus.textContent = message || "";
      addStatus.hidden = !message;
      if (variant) addStatus.setAttribute("data-variant", variant);
      else addStatus.removeAttribute("data-variant");
    }

    function refreshItemStates() {
      dialog.querySelectorAll(".ccy-check-item").forEach(function (item) {
        var input = item.querySelector('input[name="enabled_currencies"]');
        item.classList.toggle("ccy-check-item--inactive", !(input && input.checked));
      });
    }

    function renderActiveChips() {
      var enabled = currentBoxes().filter(function (x) { return x.checked; });
      chipsRoot.innerHTML = "";
      enabled.forEach(function (box) {
        var code = box.value || "";
        var chip = document.createElement("span");
        chip.className = "dict-ccy-chip";
        var icon = document.createElement("span");
        icon.className = "dict-ccy-chip-icon";
        icon.setAttribute("data-ccy-icon", code);
        icon.setAttribute("aria-hidden", "true");
        if (meta && meta.iconHtmlSmall) icon.innerHTML = meta.iconHtmlSmall(code);
        else icon.textContent = code.slice(0, 2);
        var text = document.createElement("span");
        text.className = "dict-ccy-chip-code";
        text.textContent = code;
        chip.appendChild(icon);
        chip.appendChild(text);
        chipsRoot.appendChild(chip);
      });
      refreshItemStates();
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    }

    function openDialog() {
      refreshItemStates();
      setAddStatus("", "");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "open");
    }

    function bindCcyItem(item) {
      if (!item || item.getAttribute("data-ccy-bound") === "1") return;
      item.setAttribute("data-ccy-bound", "1");
      item.addEventListener("click", function (ev) {
        var input = item.querySelector('input[name="enabled_currencies"]');
        if (!input) return;
        if (ev.target === input) return;
        ev.preventDefault();
        input.checked = !input.checked;
        refreshItemStates();
      });
      var input = item.querySelector('input[name="enabled_currencies"]');
      if (input) {
        input.addEventListener("change", refreshItemStates);
      }
    }

    function buildCcyItem(code, checked) {
      var item = document.createElement("label");
      item.className = "ccy-check-item";
      item.setAttribute("data-ccy-item", code);

      var available = document.createElement("input");
      available.type = "hidden";
      available.name = "available_currencies";
      available.value = code;
      available.setAttribute("data-ccy-available", code);

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "enabled_currencies";
      checkbox.value = code;
      checkbox.checked = checked !== false;

      var box = document.createElement("span");
      box.className = "ccy-check-box";

      var icon = document.createElement("span");
      icon.className = "ccy-check-icon";
      icon.setAttribute("data-ccy-icon", code);
      icon.setAttribute("aria-hidden", "true");

      var text = document.createElement("span");
      text.className = "ccy-check-text";
      text.textContent = code;

      var sub = document.createElement("span");
      sub.className = "ccy-check-sub";
      sub.setAttribute("data-ccy-symbol", code);

      item.appendChild(available);
      item.appendChild(checkbox);
      item.appendChild(box);
      item.appendChild(icon);
      item.appendChild(text);
      item.appendChild(sub);
      decorateCcyNodes(item);
      bindCcyItem(item);
      return item;
    }

    function addCurrencyFromInput() {
      if (!grid || !addInput) return;
      var code = normalizeCcyCode(addInput.value);
      if (!code) {
        setAddStatus("Введите код валюты из 3 латинских букв.", "err");
        addInput.focus();
        return;
      }
      var existing = dialog.querySelector('[data-ccy-item="' + code + '"]');
      if (existing) {
        var existingBox = existing.querySelector('input[name="enabled_currencies"]');
        if (existingBox) existingBox.checked = true;
        setAddStatus(code + " уже есть в списке и включена.", "ok");
        refreshItemStates();
        renderActiveChips();
        addInput.value = "";
        return;
      }
      grid.appendChild(buildCcyItem(code, true));
      addInput.value = "";
      setAddStatus(code + " добавлена. Нажмите “Сохранить”, чтобы применить.", "ok");
      refreshItemStates();
      renderActiveChips();
    }

    dialog.querySelectorAll(".ccy-check-item").forEach(function (item) {
      bindCcyItem(item);
    });

    if (openBtn) openBtn.addEventListener("click", openDialog);
    dialog.querySelectorAll("[data-ccy-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("cancel", function (ev) {
      ev.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) closeDialog();
    });
    if (addBtn) {
      addBtn.addEventListener("click", addCurrencyFromInput);
    }
    if (addInput) {
      addInput.addEventListener("input", function () {
        var clean = String(addInput.value || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
        if (addInput.value !== clean) addInput.value = clean;
        setAddStatus("", "");
      });
      addInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          addCurrencyFromInput();
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var enabled = currentBoxes().filter(function (x) { return x.checked; });
        if (!enabled.length) {
          alert(t("settings.js.leave_one_ccy"));
          return;
        }
        saveBtn.disabled = true;
        var codes = enabled.map(function (x) { return x.value; });
        savePreferences({
          available_currencies: currentAvailableCodes(),
          enabled_currencies: codes
        })
          .then(function () {
            renderActiveChips();
            closeDialog();
            showPrefToast();
          })
          .catch(function (err) {
            alert(err.message || t("settings.js.save_err"));
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });
    }

    renderActiveChips();
  }

  function initRolePermissions() {
    var root = document.querySelector("[data-roles-settings]");
    if (!root) return;
    var saveBtn = root.querySelector("[data-roles-save]");
    if (!saveBtn) return;
    function parseRowPermissions(row) {
      try {
        var parsed = JSON.parse(row.getAttribute("data-role-permissions") || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (err) {
        return {};
      }
    }
    function applyRoleRows(rolesPayload) {
      if (!Array.isArray(rolesPayload)) return;
      var byId = {};
      rolesPayload.forEach(function (role) {
        if (role && role.id) byId[String(role.id)] = role.permissions || {};
      });
      root.querySelectorAll("[data-role-row]").forEach(function (row) {
        var roleId = row.getAttribute("data-role-row") || "";
        if (!Object.prototype.hasOwnProperty.call(byId, roleId)) return;
        row.setAttribute("data-role-permissions", JSON.stringify(byId[roleId] || {}));
      });
    }
    saveBtn.addEventListener("click", function () {
      var roles = {};
      root.querySelectorAll("[data-role-row]").forEach(function (row) {
        var roleId = row.getAttribute("data-role-row") || "";
        if (!roleId) return;
        roles[roleId] = parseRowPermissions(row);
        row.querySelectorAll("[data-role-permission]").forEach(function (box) {
          roles[roleId][box.getAttribute("data-role-permission") || ""] = !!box.checked;
        });
      });
      saveBtn.disabled = true;
      fetch("/api/settings/roles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken(),
        },
        body: JSON.stringify({ roles: roles }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.save_err"));
            return body;
          });
        })
        .then(function (body) {
          applyRoleRows(body.roles);
          showPrefToast();
        })
        .catch(function (err) {
          alert(err.message || t("settings.js.save_err"));
        })
        .finally(function () {
          saveBtn.disabled = false;
        });
    });
  }

  function initCategoryManagement() {
    var catDialog = document.getElementById("settings-cat-dialog");
    var catTitle = catDialog ? catDialog.querySelector("[data-cat-modal-title]") : null;
    var catDesc = catDialog ? catDialog.querySelector("[data-cat-modal-desc]") : null;
    var activeCatType = "";

    function updateTypeCount(type) {
      var list = catDialog
        ? catDialog.querySelector('.settings-cat-list[data-cat-type="' + type + '"]')
        : document.querySelector('.settings-cat-list[data-cat-type="' + type + '"]');
      if (!list) return;
      var badge = document.querySelector('[data-cat-type-count="' + type + '"]');
      if (badge) badge.textContent = String(list.querySelectorAll("[data-cat-id]").length);
    }

    function showCatForm(type) {
      if (!catDialog) return;
      catDialog.querySelectorAll("[data-cat-form]").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-cat-form") !== type;
      });
    }

    function closeCatDialog() {
      if (!catDialog) return;
      if (catDialog.open) catDialog.close();
      else catDialog.removeAttribute("open");
      activeCatType = "";
    }

    function openCatDialog(type, triggerBtn) {
      if (!catDialog) return;
      activeCatType = type;
      showCatForm(type);
      if (triggerBtn) {
        var label = triggerBtn.querySelector(".cat-type-label");
        var desc = triggerBtn.querySelector(".cat-type-desc");
        if (catTitle && label) catTitle.textContent = label.textContent || "";
        if (catDesc && desc) catDesc.textContent = desc.textContent || "";
      }
      if (typeof catDialog.showModal === "function") catDialog.showModal();
      else catDialog.setAttribute("open", "open");
      var addInput = catDialog.querySelector('[data-cat-add-input="' + type + '"]');
      if (addInput) addInput.focus();
    }

    document.querySelectorAll("[data-cat-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openCatDialog(btn.getAttribute("data-cat-open") || "", btn);
      });
    });

    if (catDialog) {
      catDialog.querySelectorAll("[data-cat-modal-close]").forEach(function (btn) {
        btn.addEventListener("click", closeCatDialog);
      });
      catDialog.addEventListener("cancel", function (ev) {
        ev.preventDefault();
        closeCatDialog();
      });
      catDialog.addEventListener("click", function (ev) {
        if (ev.target === catDialog) closeCatDialog();
      });
    }

    function categoryApiErrorMessage(code, fallback) {
      var c = String(code || "").trim();
      if (c === "protected_category") return "Категория используется в отчётах, её нельзя изменить или удалить.";
      return c || fallback || t("settings.js.net_err");
    }

    function applyCategoryProtection(row, protectedCat) {
      if (!row) return;
      var locked = !!protectedCat;
      var title = locked ? "Категория используется в отчётах" : "";
      row.setAttribute("data-cat-protected", locked ? "1" : "0");
      var input = row.querySelector("[data-cat-name]");
      var save = row.querySelector("[data-cat-save]");
      var del = row.querySelector("[data-cat-del]");
      if (input) {
        input.disabled = locked;
        input.title = title;
      }
      if (save && locked) save.disabled = true;
      if (del) {
        del.disabled = locked;
        del.title = title;
      }
    }

    function setRowBusy(row, busy) {
      if (!row) return;
      var scope = row.querySelector(".settings-cat-main-row") || row;
      scope.querySelectorAll("button, input").forEach(function (el) {
        el.disabled = !!busy;
      });
      if (!busy) applyCategoryProtection(row, row.getAttribute("data-cat-protected") === "1");
    }

    function subcategoryChipsHtml(catId, subcategories) {
      return (Array.isArray(subcategories) ? subcategories : []).map(function (name) {
        return (
          '<span class="settings-cat-subcat-chip" data-cat-subcat="' +
          escapeHtml(name) +
          '"><span>' +
          escapeHtml(name) +
          '</span><button type="button" data-cat-subcat-del="' +
          escapeHtml(catId) +
          '" data-cat-subcat-name="' +
          escapeHtml(name) +
          '" aria-label="Удалить подкатегорию">×</button></span>'
        );
      }).join("");
    }

    function renderCategorySubcategories(row, subcategories) {
      if (!row) return;
      var catId = row.getAttribute("data-cat-id") || "";
      var list = row.querySelector("[data-cat-subcat-list]");
      if (list) list.innerHTML = subcategoryChipsHtml(catId, subcategories || []);
      bindSubcategoryControls(row);
    }

    function bindSubcategoryControls(row) {
      if (!row) return;
      var toggle = row.querySelector("[data-cat-subcat-toggle]");
      var panel = row.querySelector("[data-cat-subcats]");
      var addBtn = row.querySelector("[data-cat-subcat-add]");
      var input = row.querySelector("[data-cat-subcat-input]");
      if (toggle && panel && toggle.dataset.bound !== "1") {
        toggle.dataset.bound = "1";
        toggle.addEventListener("click", function () {
          var expanded = panel.hidden;
          panel.hidden = !expanded;
          toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          toggle.textContent = expanded ? "−" : "+";
          row.classList.toggle("is-subcats-open", expanded);
          if (expanded && input) input.focus();
        });
      }
      if (addBtn && addBtn.dataset.bound !== "1") {
        addBtn.dataset.bound = "1";
        addBtn.addEventListener("click", function () {
          var id = addBtn.getAttribute("data-cat-subcat-add") || "";
          var name = (input && input.value ? input.value : "").trim();
          if (!name) {
            if (input) input.focus();
            return;
          }
          addBtn.disabled = true;
          fetch("/api/categories/subcategories/add", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken(),
            },
            body: JSON.stringify({ id: id, name: name }),
          })
            .then(function (res) {
              return res.json().then(function (body) {
                if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.create_err"));
                return body;
              });
            })
            .then(function (body) {
              if (input) input.value = "";
              renderCategorySubcategories(row, (body.category || {}).subcategories || []);
            })
            .catch(function (err) {
              alert(err.message || t("settings.js.net_err"));
            })
            .finally(function () {
              addBtn.disabled = false;
            });
        });
      }
      if (input && input.dataset.bound !== "1") {
        input.dataset.bound = "1";
        input.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            if (addBtn) addBtn.click();
          }
        });
      }
      row.querySelectorAll("[data-cat-subcat-del]").forEach(function (btn) {
        if (btn.dataset.bound === "1") return;
        btn.dataset.bound = "1";
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-cat-subcat-del") || "";
          var name = btn.getAttribute("data-cat-subcat-name") || "";
          btn.disabled = true;
          fetch("/api/categories/subcategories/delete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken(),
            },
            body: JSON.stringify({ id: id, name: name }),
          })
            .then(function (res) {
              return res.json().then(function (body) {
                if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.del_err"));
                return body;
              });
            })
            .then(function (body) {
              renderCategorySubcategories(row, (body.category || {}).subcategories || []);
            })
            .catch(function (err) {
              alert(err.message || t("settings.js.net_err"));
              btn.disabled = false;
            });
        });
      });
    }

    function createCategoryRow(cat) {
      var row = document.createElement("div");
      row.className = "settings-cat-row";
      row.setAttribute("data-cat-id", cat.id);
      row.setAttribute("data-cat-protected", cat.protected ? "1" : "0");
      row.innerHTML =
        '<div class="settings-cat-main-row">' +
        '<button type="button" class="settings-cat-icon settings-cat-subcat-toggle settings-cat-icon--' +
        escapeHtml(cat.type) +
        '" data-cat-subcat-toggle="' +
        escapeHtml(cat.id) +
        '" aria-expanded="false" aria-label="Показать подкатегории">+</button>' +
        '<input type="text" class="settings-cat-name-input" value="' +
        escapeHtml(cat.name) +
        '" data-cat-name="' +
        escapeHtml(cat.id) +
        '" aria-label="' +
        escapeHtml(t("settings.cat.name_aria")) +
        '" />' +
        '<div class="settings-cat-actions">' +
        '<button type="button" class="btn-cat-save" aria-label="' +
        escapeHtml(t("settings.cat.save_aria")) +
        '" data-cat-save="' +
        escapeHtml(cat.id) +
        '" data-cat-type="' +
        escapeHtml(cat.type) +
        '" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>' +
        '<button type="button" class="btn-cat-del" aria-label="' +
        escapeHtml(t("settings.cat.del_aria")) +
        '" data-cat-del="' +
        escapeHtml(cat.id) +
        '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        "</div></div>" +
        '<div class="settings-cat-subcats" data-cat-subcats="' +
        escapeHtml(cat.id) +
        '" hidden><div class="settings-cat-subcat-list" data-cat-subcat-list="' +
        escapeHtml(cat.id) +
        '">' +
        subcategoryChipsHtml(cat.id, cat.subcategories || []) +
        '</div><div class="settings-cat-subcat-add"><input type="text" class="settings-cat-subcat-input" placeholder="Новая подкатегория..." data-cat-subcat-input="' +
        escapeHtml(cat.id) +
        '" /><button type="button" class="btn btn-secondary btn-sm" data-cat-subcat-add="' +
        escapeHtml(cat.id) +
        '">Добавить</button></div></div>';
      applyCategoryProtection(row, !!cat.protected);
      bindCategoryRow(row);
      return row;
    }

    function bindCategoryRow(row) {
      applyCategoryProtection(row, row.getAttribute("data-cat-protected") === "1");
      var input = row.querySelector("[data-cat-name]");
      var save = row.querySelector("[data-cat-save]");
      var del = row.querySelector("[data-cat-del]");
      bindSubcategoryControls(row);

      if (input && save) {
        input.dataset.originalValue = input.value || "";
        input.addEventListener("input", function () {
          save.disabled = (input.value || "").trim() === (input.dataset.originalValue || "").trim();
        });
        input.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            if (!save.disabled) save.click();
          }
        });
        save.addEventListener("click", function () {
          var id = save.getAttribute("data-cat-save");
          var type = save.getAttribute("data-cat-type") || "expense";
          var name = (input.value || "").trim();
          if (!name) {
            input.focus();
            return;
          }
          setRowBusy(row, true);
          fetch("/api/categories/update", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken(),
            },
            body: JSON.stringify({ id: id, name: name, type: type }),
          })
            .then(function (res) {
              return res.json().then(function (body) {
                if (!res.ok || !body.ok) throw new Error(categoryApiErrorMessage(body.error, t("settings.js.save_err")));
                return body;
              });
            })
            .then(function (body) {
              input.value = body.category.name;
              input.dataset.originalValue = body.category.name;
              applyCategoryProtection(row, !!body.category.protected);
              setRowBusy(row, false);
              save.disabled = true;
            })
            .catch(function (err) {
              alert(err.message || t("settings.js.net_err"));
              setRowBusy(row, false);
              save.disabled = row.getAttribute("data-cat-protected") === "1";
            });
        });
      }

      if (del && !del.disabled && row.getAttribute("data-cat-protected") !== "1") {
        del.addEventListener("click", function () {
          var id = del.getAttribute("data-cat-del");
          var list = row.closest("[data-cat-type]");
          var type = list ? list.getAttribute("data-cat-type") : "";
          if (!confirm(t("settings.js.cat_del_confirm"))) return;
          setRowBusy(row, true);
          fetch("/api/categories/delete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken(),
            },
            body: JSON.stringify({ id: id }),
          })
            .then(function (res) {
              return res.json().then(function (body) {
                if (!res.ok || !body.ok) throw new Error(categoryApiErrorMessage(body.error, t("settings.js.del_err")));
                return body;
              });
            })
            .then(function () {
              row.remove();
              updateTypeCount(type);
            })
            .catch(function (err) {
              alert(err.message || t("settings.js.net_err"));
              setRowBusy(row, false);
            });
        });
      }
    }

    (catDialog || document).querySelectorAll(".settings-cat-row[data-cat-id]").forEach(function (row) {
      bindCategoryRow(row);
    });

    (catDialog || document).querySelectorAll("[data-cat-add-btn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var type = btn.getAttribute("data-cat-add-btn");
        var input = catDialog
          ? catDialog.querySelector('[data-cat-add-input="' + type + '"]')
          : document.querySelector('[data-cat-add-input="' + type + '"]');
        var name = (input && input.value ? input.value : "").trim();
        if (!name) {
          if (input) input.focus();
          return;
        }
        btn.disabled = true;
        fetch("/api/categories/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken(),
          },
          body: JSON.stringify({ name: name, type: type }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || !body.ok) throw new Error(body.error || t("settings.js.create_err"));
              return body;
            });
          })
          .then(function (body) {
            var list = catDialog
              ? catDialog.querySelector('.settings-cat-list[data-cat-type="' + type + '"]')
              : document.querySelector('.settings-cat-list[data-cat-type="' + type + '"]');
            if (list && !list.querySelector('[data-cat-id="' + body.id + '"]')) {
              list.appendChild(createCategoryRow(body));
            }
            if (input) input.value = "";
            updateTypeCount(type);
            btn.disabled = false;
          })
          .catch(function (err) {
            alert(err.message || t("settings.js.net_err"));
            btn.disabled = false;
          });
      });
    });
  }

  function boot() {
    initTokenAntiAutofill(document.querySelector(".js-settings-bot-token"));
    document.querySelectorAll(".js-anti-autofill").forEach(initTokenAntiAutofill);
    initLanguageDropdowns();
    initPreferencesAutoSave();
    initIntegrationModals();
    initSocialSettings();
    initSocialTelegramIntegration();
    initProfileEditor();
    initCurrencyVisibility();
    initRolePermissions();
    initCategoryManagement();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
