// Shared Cart System for Black Room
(function() {
  const CART_KEY = 'cart';
  
  // Inject Cart CSS
  function injectCartCSS() {
    if (document.getElementById('cart-styles')) return;
    
    const css = `
      .cart-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        z-index: 1999;
      }
      .cart-overlay.active { display: block; }
      
      .cart-modal {
        display: none;
        position: fixed;
        top: 0;
        right: -100%;
        width: 400px;
        max-width: 90vw;
        height: 100vh;
        background: #111;
        z-index: 2000;
        flex-direction: column;
        border-left: 1px solid rgba(255,255,255,0.1);
        transition: right 0.3s ease;
      }
      .cart-modal.active {
        display: flex;
        right: 0;
      }
      
      .cart-header {
        padding: 1.5rem;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .cart-header h2 {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 600;
        color: #fff;
      }
      .close-cart {
        background: none;
        border: none;
        color: #fff;
        font-size: 1.8rem;
        cursor: pointer;
        line-height: 1;
        padding: 0;
      }
      .close-cart:hover { color: #ff6b6b; }
      
      .cart-items {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
      }
      
      .cart-item {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        margin-bottom: 1rem;
        align-items: flex-start;
      }
      .cart-item img {
        width: 70px;
        height: 70px;
        object-fit: cover;
        border-radius: 6px;
        background: #222;
      }
      .cart-item-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .cart-item-name {
        font-weight: 600;
        font-size: 0.95rem;
        color: #fff;
      }
      .cart-item-details {
        font-size: 0.85rem;
        color: #888;
      }
      .cart-item-price {
        color: #ff6b6b;
        font-weight: 700;
        font-size: 1rem;
        margin-top: 0.25rem;
      }
      .remove-item {
        background: none;
        border: none;
        color: #ff4444;
        cursor: pointer;
        font-size: 0.8rem;
        padding: 0.25rem 0.5rem;
        transition: color 0.2s;
      }
      .remove-item:hover { color: #ff6666; }
      
      .cart-footer {
        padding: 1.5rem;
        border-top: 1px solid rgba(255,255,255,0.1);
        background: rgba(0,0,0,0.3);
      }
      .cart-total {
        display: flex;
        justify-content: space-between;
        margin-bottom: 1rem;
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
      }
      .checkout-btn {
        width: 100%;
        padding: 1rem;
        background: linear-gradient(135deg, #ff6b6b, #d32f2f);
        border: none;
        color: #fff;
        font-weight: 700;
        border-radius: 8px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-size: 0.95rem;
        transition: all 0.3s;
      }
      .checkout-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(255,107,107,0.4);
      }
      
      .empty-cart {
        text-align: center;
        padding: 3rem 1rem;
        color: #666;
      }
      .empty-cart p { margin: 0.5rem 0; }
      
      @media (max-width: 480px) {
        .cart-modal { width: 100%; max-width: 100%; }
        .cart-item img { width: 60px; height: 60px; }
      }
    `;
    
    const style = document.createElement('style');
    style.id = 'cart-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }
  
  // Inject Cart HTML
  function injectCartHTML() {
    if (document.getElementById('shared-cart-modal')) return;
    
    const html = `
      <div class="cart-overlay" id="cart-overlay"></div>
      <div class="cart-modal" id="shared-cart-modal">
        <div class="cart-header">
          <h2>Your Cart</h2>
          <button class="close-cart" id="close-cart-btn">&times;</button>
        </div>
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-footer">
          <div class="cart-total">
            <span>Total</span>
            <span id="cart-total">$0.00</span>
          </div>
          <button class="checkout-btn" id="checkout-btn">Check Out →</button>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Setup event listeners
    document.getElementById('cart-overlay').onclick = toggleCart;
    document.getElementById('close-cart-btn').onclick = toggleCart;
    document.getElementById('checkout-btn').onclick = checkout;
  }
  
  // Cart functions
  function getCart() {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  }
  
  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }
  
  function renderCart() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    const cart = getCart();
    
    if (!cart.length) {
      container.innerHTML = '<div class="empty-cart"><p>Your cart is empty</p><p>Add some items to get started!</p></div>';
      totalEl.textContent = '$0.00';
      return;
    }
    
    container.innerHTML = cart.map((item, i) => `
      <div class="cart-item">
        <img src="${item.image || '/images/products/red-room-front.jpg'}" alt="${item.name}">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-details">Size: ${item.size || 'M'} | Qty: ${item.qty || 1}</div>
          <div class="cart-item-price">$${(item.price * (item.qty || 1)).toFixed(2)}</div>
        </div>
        <button class="remove-item" onclick="window.removeFromCart(${i})">Remove</button>
      </div>
    `).join('');
    
    const total = cart.reduce((sum, item) => sum + (item.price * (item.qty || 1)), 0);
    totalEl.textContent = '$' + total.toFixed(2);
  }
  
  function toggleCart() {
    const modal = document.getElementById('shared-cart-modal');
    const overlay = document.getElementById('cart-overlay');
    
    if (!modal || !overlay) return;
    
    const isActive = modal.classList.contains('active');
    
    if (isActive) {
      modal.classList.remove('active');
      overlay.classList.remove('active');
    } else {
      modal.classList.add('active');
      overlay.classList.add('active');
      renderCart();
    }
  }
  
  function removeFromCart(index) {
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    renderCart();
  }
  
  async function checkout() {
    const cart = getCart();
    if (!cart.length) return alert('Cart is empty.');
    
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Processing...';
    }
    
    try {
      console.log('🛒 Starting checkout with cart:', cart);
      
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            qty: item.qty || 1,
            size: item.size || '',
            image: item.image || ''
          }))
        })
      });
      
      const data = await response.json();
      console.log('📦 Checkout response:', data);
      
      if (!data.url) {
        console.error('Checkout error:', data.error);
        if (checkoutBtn) {
          checkoutBtn.disabled = false;
          checkoutBtn.textContent = 'Check Out →';
        }
        return alert('Error: ' + (data.error || 'Unknown error'));
      }
      
      // Clear cart before redirecting to Stripe
      localStorage.removeItem('cart');
      
      console.log('🔗 Redirecting to Stripe:', data.url);
      window.location.href = data.url;
    } catch (error) {
      console.error('Checkout fetch error:', error);
      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = 'Check Out →';
      }
      alert('Network error. Please try again.');
    }
  }
  
  // Initialize cart
  function initCart() {
    injectCartCSS();
    injectCartHTML();
  }
  
  // Expose functions globally
  window.toggleCart = toggleCart;
  window.removeFromCart = removeFromCart;
  window.getCart = getCart;
  window.saveCart = saveCart;
  window.renderCart = renderCart;
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCart);
  } else {
    initCart();
  }
})();
