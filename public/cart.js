function checkout() {
  const cart = getCart();
  if (!cart.length) {
    alert("Carrito vacío.");
    return;
  }

  const checkoutBtn = document.getElementById("checkout-button");
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Procesando...";
    checkoutBtn.style.opacity = 0.6;
  }

  console.log('🛒 Starting checkout process with cart:', cart);

  // Track checkout initiated
  if (window.brTrackShop) {
    const totalPrice = cart.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty || 1)), 0);
    const itemCount = cart.reduce((sum, item) => sum + parseInt(item.qty || 1), 0);
    brTrackShop('checkout_initiated', { id: 'checkout', name: 'Checkout Started', price: totalPrice, quantity: itemCount });
  }

  // Convertir el carrito al formato correcto para el servidor
  const formattedCart = cart.map(item => ({
    id: item.id,
    name: item.name,
    price: parseFloat(item.price || 0),
    qty: parseInt(item.qty || item.quantity || 1),
    quantity: parseInt(item.qty || item.quantity || 1),
    size: item.size || null,
    model: item.model || item.id || null,
    priceId: item.priceId || null,
    description: item.description || '',
    image: item.image || item.imageUrl || '/api/storage/images/logo.png'
  }));

  console.log('🛒 Formatted cart for server:', formattedCart);

  // Use fetch but handle mobile redirect immediately
  fetch("/api/create-checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ cart: formattedCart }),
  })
  .then(response => {
    return response.text().then(text => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("Error parsing response:", parseError);
        throw new Error("Respuesta del servidor inválida");
      }

      console.log('💳 Checkout session response:', data);

      if (!response.ok) {
        console.error("Stripe response error:", response.status, data);
        const msg = data.error || data.details || `Error ${response.status}`;
        throw new Error(msg);
      }

      if (!data.url && !data.id) {
        throw new Error("No se recibió URL de checkout");
      }

      // APPLE/SAFARI POPUP BLOCKER WORKAROUND
      if (data.url) {
        console.log('🔄 Apple/Safari popup-safe redirect to Stripe URL:', data.url);
        
        // Detect Apple devices
        const isApple = /iPad|iPhone|iPod|Safari/i.test(navigator.userAgent);
        const isMobile = window.innerWidth <= 768;
        
        if (isApple || isMobile) {
          // Apple-specific method: Show fallback with direct link
          console.log('🍎 Apple device detected, using fallback method');
          
          // Try direct redirect first
          try {
            window.open(data.url, '_blank');
          } catch (e) {
            // If blocked, show manual link
            console.log('⚠️ Popup blocked on Apple device, showing manual link');
            
            // Create and show fallback message with link
            const fallbackHTML = `
              <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;">
                <div style="background:white;padding:30px;border-radius:10px;text-align:center;max-width:400px;color:black;">
                  <h3>🍎 Safari Checkout</h3>
                  <p>Safari bloqueó el popup. Toca el botón para continuar:</p>
                  <a href="${data.url}" target="_blank" style="display:inline-block;background:#5469d4;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;margin:10px;">
                    ✅ Ir a Checkout ($${(cart.reduce((sum, item) => sum + (item.price * item.qty), 0)).toFixed(2)})
                  </a>
                  <br><br>
                  <button onclick="this.parentElement.parentElement.remove()" style="background:#666;color:white;border:none;padding:10px;border-radius:5px;">Cerrar</button>
                </div>
              </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', fallbackHTML);
            return;
          }
        } else {
          // Non-Apple devices: Use temp link method
          const tempLink = document.createElement('a');
          tempLink.href = data.url;
          tempLink.target = '_top';
          tempLink.style.display = 'none';
          document.body.appendChild(tempLink);
          tempLink.click();
          setTimeout(() => document.body.removeChild(tempLink), 100);
        }
        
        return;
      }

      // Fallback to session ID redirect
      if (data.id) {
        console.log('🔄 Safari popup-safe redirect with session ID:', data.id);
        const checkoutUrl = `https://checkout.stripe.com/c/pay/${data.id}`;
        
        // Same Safari-safe method
        const tempLink = document.createElement('a');
        tempLink.href = checkoutUrl;
        tempLink.target = '_top';
        tempLink.style.display = 'none';
        document.body.appendChild(tempLink);
        
        tempLink.click();
        
        setTimeout(() => {
          document.body.removeChild(tempLink);
        }, 100);
        
        return;
      }
    });
  })
  .catch(err => {
    console.error("Error al procesar el pago:", err);

    let userMessage = "Error al procesar el pago: " + err.message;
    userMessage += "\n\nIntenta de nuevo o contacta soporte.";

    alert(userMessage);

    // Reset button on error
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Pay Now";
      checkoutBtn.style.opacity = 1;
    }
  });
}