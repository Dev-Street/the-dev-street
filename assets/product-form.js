if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput.disabled = false;
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton.querySelector('span');

        if (document.querySelector('cart-drawer')) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = this.getFormData();
        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        // @note: gift wrap sends an items list, where the product is the first item
        const variantId = formData.get('id') ?? formData.get('items[0][id]');
        const quantity = parseInt(formData.get('quantity') ?? formData.get('items[0][quantity]')) || 1;
        const linesUpdateDeferred = this.createCartLinesUpdateEvent(variantId, quantity);

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          // @note: adding an items list returns { items, sections }, reshape it 
          .then((response) => (response.items ? { ...response.items[0], sections: response.sections } : response))
          .then((response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: variantId,
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);
              this.dispatchCartErrorEvent(response.description || response.message, 'INVALID');
              linesUpdateDeferred?.reject(new Error(response.description || response.message));

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            } else if (!this.cart) {
              this.resolveCartLinesUpdate(linesUpdateDeferred);
              window.location = window.routes.cart_url;
              return;
            }

            this.resolveCartLinesUpdate(linesUpdateDeferred);

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');
            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: variantId,
                cartData: response,
              }).then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);
              });
            this.error = false;
            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", () => {
                      this.cart.renderContents(response);
                    });
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", () => {
                this.cart.renderContents(response);
              });
            }
          })
          .catch((e) => {
            console.error(e);
            this.dispatchCartErrorEvent(e.message || 'Network error', 'SERVICE_UNAVAILABLE');
            linesUpdateDeferred?.reject(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      /**
       * Builds the add to cart form data. Gift wrap details are only sent when
       * the gift wrap checkbox is ticked, and a paid gift wrap product is added
       * as a nested cart line under the product.
       * @returns {FormData}
       */
      getFormData() {
        const giftWrapToggleEl = [...this.form.elements].find((el) => el.matches('[data-gift-wrap-toggle]'));
        if (!giftWrapToggleEl) return new FormData(this.form);

        const giftWrapFieldsEl = document.getElementById(giftWrapToggleEl.getAttribute('aria-controls'));
        if (!giftWrapFieldsEl) return new FormData(this.form);

        // Disabled fields are left out of FormData, so disabling the gift wrap
        // fields while reading the form drops them when the box isn't ticked
        giftWrapFieldsEl.disabled = !giftWrapToggleEl.checked;
        const formData = new FormData(this.form);
        giftWrapFieldsEl.disabled = false;

        const giftWrapVariantId = formData.get('gift_wrap_variant_id');
        if (!giftWrapVariantId) return formData;

        return this.getNestedGiftWrapFormData(formData, giftWrapVariantId);
      }

      /**
       * Converts single product form data into an items list, with the gift
       * wrap variant nested under the product so it's removed along with it
       * @param {FormData} formData Form data for a single product
       * @param {string} giftWrapVariantId Variant ID of the gift wrap product
       * @returns {FormData}
       */
      getNestedGiftWrapFormData(formData, giftWrapVariantId) {
        const itemsFormData = new FormData();
        const itemFields = ['id', 'quantity', 'selling_plan'];

        for (const [key, value] of formData) {
          const isItemField = itemFields.includes(key) || key.startsWith('properties[');
          if (!isItemField) continue;

          // id -> items[0][id], properties[To] -> items[0][properties][To]
          itemsFormData.append(key.replace(/^[^[]+/, (name) => `items[0][${name}]`), value);
        }

        itemsFormData.append('items[1][id]', giftWrapVariantId);
        itemsFormData.append('items[1][quantity]', 1);
        itemsFormData.append('items[1][parent_id]', formData.get('id'));
        // @note: private property (leading underscore) so the cart can tell gift wrap lines apart from other add-ons
        itemsFormData.append('items[1][properties][_gift_wrap]', 'true');

        return itemsFormData;
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          if (text) this.submitButtonText.textContent = text;
        } else {
          this.submitButton.removeAttribute('disabled');
          this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }

      createCartLinesUpdateEvent(variantId, quantity) {
        const { CartLinesUpdateEvent } = window.StandardEvents || {};
        if (!CartLinesUpdateEvent) return null;

        const deferred = CartLinesUpdateEvent.createPromise();
        this.dispatchEvent(
          new CartLinesUpdateEvent({
            action: 'add',
            context: 'product',
            lines: [{ merchandiseId: variantId, quantity }],
            promise: deferred.promise,
          })
        );
        return deferred;
      }

      resolveCartLinesUpdate(deferred) {
        if (!deferred) return;
        const { CartLinesUpdateEvent } = window.StandardEvents || {};
        if (!CartLinesUpdateEvent) return;

        const pendingCartDataPromise = typeof CartItems !== 'undefined'
          ? CartItems.fetchCartData()
          : fetch(`${routes.cart_url}.json`).then((response) => response.json());

        pendingCartDataPromise
          .then((cart) => {
            if (!cart?.currency) return deferred.reject(new Error('Missing currency in cart response'));
            deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart) });
          })
          .catch((e) => deferred.reject(e));
      }

      dispatchCartErrorEvent(message, code) {
        const { CartErrorEvent } = window.StandardEvents || {};
        if (!CartErrorEvent) return;
        this.dispatchEvent(new CartErrorEvent({ error: message, code }));
      }

      get variantIdInput() {
        return this.form.querySelector('[name=id]');
      }
    }
  );
}
