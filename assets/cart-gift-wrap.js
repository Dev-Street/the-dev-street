/**
 * Cart gift wrap
 * Saves edits to a cart line's gift wrap, or removes it, from the cart drawer.
 */
(() => {
  class CartGiftWrap extends HTMLElement {
    connectedCallback() {
      this.toggleEl = this.querySelector('[data-gift-wrap-toggle]');
      this.inputEls = [...this.querySelectorAll('[data-gift-wrap-input]')];
      this.updateButtonEl = this.querySelector('[data-gift-wrap-update]');
      this.errorEl = this.querySelector('[data-gift-wrap-error]');
      if (!this.toggleEl || !this.updateButtonEl) return;

      this.addEventListener('change', this.handleChange);
      this.addEventListener('keydown', this.handleKeydown);
      this.updateButtonEl.addEventListener('click', this.handleUpdate);
    }

    disconnectedCallback() {
      this.removeEventListener('change', this.handleChange);
      this.removeEventListener('keydown', this.handleKeydown);
      this.updateButtonEl?.removeEventListener('click', this.handleUpdate);
    }

    // @note: dawn's cart drawer treats any input change inside it as a quantity
    // this stop gift wrap edits from reaching it
    handleChange = (event) => {
      event.stopPropagation();
    };

    // @note: enter in a text field would otherwise submit the cart drawer's form
    /** @param {KeyboardEvent} event */
    handleKeydown = (event) => {
      if (event.key !== 'Enter') return;
      if (event.target.type !== 'text') return;

      event.preventDefault();
      this.handleUpdate();
    };

    handleUpdate = async () => {
      this.updateButtonEl.disabled = true;
      this.errorEl.textContent = '';

      try {
        if (this.toggleEl.checked) {
          await this.saveGiftWrap();
        } else {
          await this.removeGiftWrap();
        }
      } catch {
        this.errorEl.textContent = window.cartStrings.error;
        this.updateButtonEl.disabled = false;
        return;
      }

      // @note: dawn's cart drawer re-renders itself when a cart update is published
      publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-gift-wrap' });
    };

    /**
     * @note: saves the edited details to the product's line item properties
     */
    async saveGiftWrap() {
      const properties = this.getProperties();

      for (const inputEl of this.inputEls) {
        const name = inputEl.dataset.giftWrapInput;
        const value = inputEl.value.trim();
        delete properties[name];
        if (value) properties[name] = value;
      }

      await this.changeLine({ id: this.dataset.lineKey, quantity: Number(this.dataset.quantity), properties });
    }

    /**
     * @note: removes the gift wrap line, then the gift wrap details from the product
     */
    async removeGiftWrap() {
      const { giftWrapLineKey } = this.dataset;
      if (giftWrapLineKey) await this.changeLine({ id: giftWrapLineKey, quantity: 0 });

      const properties = this.getProperties();
      const giftWrapProperties = [
        this.toggleEl.dataset.giftWrapToggle,
        ...this.inputEls.map((inputEl) => inputEl.dataset.giftWrapInput),
      ];
      for (const name of giftWrapProperties) delete properties[name];

      await this.changeLine({ id: this.dataset.lineKey, quantity: Number(this.dataset.quantity), properties });
    }

    /**
     * @returns {Object} A copy of the product line's current properties
     */
    getProperties() {
      const properties = JSON.parse(this.dataset.properties);
      return Array.isArray(properties) ? Object.fromEntries(properties) : properties;
    }

    /**
     * Updates a single cart line
     * @param {{ id: string, quantity: number, properties?: Object }} line
     */
    async changeLine(line) {
      const response = await fetch(window.routes.cart_change_url, {
        ...fetchConfig(),
        body: JSON.stringify(line),
      });
      if (!response.ok) throw new Error(`Cart change failed with status ${response.status}`);
    }
  }

  if (customElements.get('cart-gift-wrap')) return;
  customElements.define('cart-gift-wrap', CartGiftWrap);
})();