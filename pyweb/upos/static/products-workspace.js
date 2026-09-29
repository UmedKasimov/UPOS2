(() => {
  const productForm = document.querySelector("#product-form form.product-form");
  if (productForm) {
    const section = productForm.querySelector("[data-service-extra]");
    const productPriceSection = productForm.querySelector("[data-product-price-extra]");
    const productId = productForm.querySelector('input[name="product_id"]');
    const categoryLabel = productForm.querySelector("[data-product-category-label]");
    const categorySelect = productForm.querySelector('[data-product-dictionary-select="category"]');
    const brandField = productForm.querySelector("[data-product-brand-field]");
    const brandSelect = productForm.querySelector('[data-product-dictionary-select="brand"]');
    const barcodeSection = productForm.querySelector("[data-product-barcode-section]");

    const syncKind = () => {
      if (!section) return;
      const service = productForm.querySelector('input[name="kind"][value="service"]');
      const subscription = productForm.querySelector('input[name="kind"][value="subscription"]');
      const isService = Boolean(service?.checked);
      const isSubscription = Boolean(subscription?.checked);
      const isStockProduct = !isService && !isSubscription;
      const isCreate = !productId?.value;

      section.hidden = !isService;
      if (productPriceSection) productPriceSection.hidden = isService;
      productForm.querySelectorAll("[data-product-price-input]").forEach((input) => {
        input.disabled = isService;
        if (input.name === "price_value") input.required = !isService && isCreate;
      });
      productForm.querySelectorAll("[data-service-price-input]").forEach((input) => {
        input.disabled = !isService;
        if (input.name === "service_sale_price") input.required = isService && isCreate;
      });
      if (categoryLabel) categoryLabel.textContent = isSubscription ? "Программа*" : "Категория*";
      if (categorySelect?.options.length) {
        categorySelect.options[0].textContent = isSubscription ? "Выберите программу" : "Выберите категорию";
      }
      if (brandField) brandField.hidden = isSubscription;
      if (brandSelect) {
        brandSelect.disabled = isSubscription;
        brandSelect.required = !isSubscription && isCreate;
      }
      const liveBarcodeSection = barcodeSection || productForm.querySelector("[data-product-barcode-section]");
      if (liveBarcodeSection) {
        liveBarcodeSection.hidden = !isStockProduct;
        liveBarcodeSection.querySelectorAll("input, select").forEach((input) => {
          input.disabled = !isStockProduct;
        });
      }
    };

    productForm.querySelectorAll('input[name="kind"]').forEach((radio) => {
      radio.addEventListener("change", syncKind);
    });
    syncKind();

    const preview = productForm.querySelector("[data-product-form-photo]");
    const urlField = productForm.querySelector("[data-product-form-photo-url]");
    const fileField = productForm.querySelector("[data-product-form-photo-file]");
    const showPreview = (src) => {
      if (!preview) return;
      preview.replaceChildren();
      if (!src) {
        preview.append(document.createElement("span"));
        return;
      }
      const image = new Image();
      image.alt = "";
      image.src = String(src);
      preview.append(image);
    };
    urlField?.addEventListener("input", () => showPreview(String(urlField.value || "").trim()));
    fileField?.addEventListener("change", () => {
      const file = fileField.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => showPreview(reader.result), { once: true });
      reader.readAsDataURL(file);
    });
    productForm.addEventListener("submit", (event) => {
      if (productId?.value) return;
      const hasUrl = Boolean(String(urlField?.value || "").trim());
      const hasFile = Boolean(fileField?.files?.length);
      if (hasUrl || hasFile) return;
      event.preventDefault();
      if (!urlField) return;
      urlField.setCustomValidity("Добавьте фото: URL или файл.");
      urlField.reportValidity();
      window.setTimeout(() => urlField.setCustomValidity(""), 1500);
    });
  }

  const priceDialog = document.getElementById("products-price-type-dialog");
  if (priceDialog) {
    const setValue = (selector, value) => {
      const node = priceDialog.querySelector(selector);
      if (node) node.value = value || "";
    };
    const setChecked = (selector, value) => {
      const node = priceDialog.querySelector(selector);
      if (node) node.checked = value === "1";
    };
    document.querySelectorAll("[data-price-type-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.id || "";
        const title = priceDialog.querySelector("[data-price-type-dialog-title]");
        if (title) title.textContent = id ? "Редактировать прайс-лист" : "Новый прайс-лист";
        setValue("[data-price-type-id]", id);
        setValue("[data-price-type-name]", button.dataset.name);
        setValue("[data-price-type-sort]", button.dataset.sortOrder || "0");
        setValue("[data-price-type-method]", button.dataset.method || "manual");
        setValue("[data-price-type-base]", button.dataset.base || "last_purchase_price");
        setValue("[data-price-type-markup-type]", button.dataset.markupType || "markup");
        setValue("[data-price-type-markup-value]", button.dataset.markupValue);
        setValue("[data-price-type-currency]", button.dataset.currency || "UZS");
        setValue("[data-price-type-rounding]", button.dataset.rounding || "1.0");
        setChecked("[data-price-type-sales]", button.dataset.forSales || "1");
        setChecked("[data-price-type-purchases]", button.dataset.forPurchases || "0");
        setChecked("[data-price-type-active]", button.dataset.active || "1");
        priceDialog.showModal?.();
        window.setTimeout(() => priceDialog.querySelector("[data-price-type-name]")?.focus(), 30);
      });
    });
    priceDialog.querySelectorAll("[data-price-type-close]").forEach((button) => {
      button.addEventListener("click", () => priceDialog.close());
    });
  }

  const dependentPriceToggles = Array.from(document.querySelectorAll("[data-dependent-price-auto]"));
  const allDependentPricesToggle = document.querySelector("[data-dependent-price-auto-all]");
  const syncAllDependentPrices = () => {
    if (!allDependentPricesToggle || !dependentPriceToggles.length) return;
    const checkedCount = dependentPriceToggles.filter((toggle) => toggle.checked).length;
    allDependentPricesToggle.checked = checkedCount === dependentPriceToggles.length;
    allDependentPricesToggle.indeterminate = checkedCount > 0 && checkedCount < dependentPriceToggles.length;
  };
  dependentPriceToggles.forEach((toggle) => {
    const input = toggle.closest(".price-type-dependent-control")?.querySelector("[data-dependent-price-input]");
    const sync = () => {
      if (!input) return;
      input.readOnly = toggle.checked;
      input.classList.toggle("is-automatic", toggle.checked);
      syncAllDependentPrices();
      window.setTimeout(syncAllDependentPrices, 0);
    };
    toggle.addEventListener("change", sync);
    sync();
  });
  allDependentPricesToggle?.addEventListener("change", () => {
    const nextChecked = allDependentPricesToggle.checked;
    dependentPriceToggles.forEach((toggle) => {
      toggle.checked = nextChecked;
      toggle.dispatchEvent(new Event("change"));
    });
    syncAllDependentPrices();
  });
  syncAllDependentPrices();

  const categoryDialog = document.getElementById("products-category-dialog");
  if (categoryDialog) {
    const title = categoryDialog.querySelector("[data-product-category-dialog-title]");
    const oldName = categoryDialog.querySelector("[data-product-category-old-name]");
    const nameInput = categoryDialog.querySelector("[data-product-category-name]");
    document.querySelectorAll("[data-product-category-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.categoryName || "";
        if (title) title.textContent = value ? "Редактировать категорию" : "Новая категория";
        if (oldName) oldName.value = value;
        if (nameInput) nameInput.value = value;
        categoryDialog.showModal?.();
        window.setTimeout(() => nameInput?.focus(), 30);
      });
    });
    categoryDialog.querySelectorAll("[data-product-category-close]").forEach((button) => {
      button.addEventListener("click", () => categoryDialog.close());
    });
  }

  const quickDialog = document.getElementById("products-dictionary-quick-dialog");
  const quickForm = quickDialog?.querySelector("[data-product-dictionary-quick-form]");
  const quickTitle = quickDialog?.querySelector("[data-product-dictionary-quick-title]");
  const quickLabel = quickDialog?.querySelector("[data-product-dictionary-quick-label]");
  const quickInput = quickDialog?.querySelector("[data-product-dictionary-quick-name]");
  const quickError = quickDialog?.querySelector("[data-product-dictionary-quick-error]");
  const quickSave = quickDialog?.querySelector("[data-product-dictionary-save]");
  let quickType = "category";
  const csrfToken = () => (
    document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
    || document.querySelector('input[name="csrf_token"]')?.value
    || ""
  );
  const addSelectOption = (type, value) => {
    document.querySelectorAll(`[data-product-dictionary-select="${type}"]`).forEach((select) => {
      if (!Array.from(select.options).some((option) => option.value === value)) {
        select.add(new Option(value, value));
      }
      select.value = value;
    });
  };
  document.querySelectorAll("[data-product-dictionary-open]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!quickDialog || !quickInput) return;
      quickType = button.dataset.productDictionaryType || "category";
      const isBrand = quickType === "brand";
      if (quickTitle) quickTitle.textContent = button.dataset.productDictionaryTitle || (isBrand ? "Новый бренд" : "Новая категория");
      if (quickLabel) quickLabel.textContent = isBrand ? "Название бренда*" : "Название категории*";
      if (quickError) {
        quickError.hidden = true;
        quickError.textContent = "";
      }
      quickInput.value = "";
      quickDialog.showModal?.();
      window.setTimeout(() => quickInput.focus(), 30);
    });
  });
  quickDialog?.querySelectorAll("[data-product-dictionary-close]").forEach((button) => {
    button.addEventListener("click", () => quickDialog.close());
  });
  quickForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = quickInput?.value.trim();
    if (!name) {
      if (quickError) {
        quickError.textContent = "Введите название.";
        quickError.hidden = false;
      }
      quickInput?.focus();
      return;
    }
    if (quickSave) quickSave.disabled = true;
    try {
      const response = await fetch(quickForm.dataset.dictionarySaveUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken(),
        },
        body: JSON.stringify({ type: quickType, name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) throw new Error(body.error || "save");
      addSelectOption(quickType, body.name || name);
      quickDialog?.close();
    } catch (error) {
      if (quickError) {
        quickError.textContent = "Не удалось сохранить. Обновите страницу и попробуйте ещё раз.";
        quickError.hidden = false;
      }
    } finally {
      if (quickSave) quickSave.disabled = false;
    }
  });
})();
