import {cart, removeFromCart, updateDeliveryOption} from '../../data/cart.js';
import {products, updateProduct} from '../../data/products.js';
import {deliveryOptions, getDeliveryOption} from '../../data/deliveryOptions.js';
import {formatPrice} from '../utils/money.js';
import {renderPaymentSummary} from './payment.js';



export function renderOrderSummary() {
  
  let cartSummaryHTML = ``;
  
  cart.forEach((cartitem) => {
    const productId = cartitem.productId;
    
    const matchingItem = updateProduct(productId);
      
      const deliveryOptionId = cartitem.deliveryOptionId;
      const deliveryOption = getDeliveryOption(deliveryOptionId);
        
        
      const today = dayjs();
      const deliveryDate = today.add(deliveryOption.deliveryDate, 'day');
      const dateString = deliveryDate.format('dddd,MMMM, D');
     cartSummaryHTML += 
     `
       <div class="cart-item-container js-cart-item-container-${matchingItem.id}">
          <div class="delivery-date">
            Delivery date: ${dateString}
          </div>
  
          <div class="cart-item-details-grid">
            <img class="product-image"
              src="${matchingItem.image}">
  
            <div class="cart-item-details">
              <div class="product-name">
                ${matchingItem.name}
              </div>
              <div class="product-price">
                $${formatPrice(matchingItem.priceCents)}
              </div>
              <div class="product-quantity">
                <span>
                  Quantity: <span class="quantity-label">${cartitem.quantity}</span>
                </span>
                <span class="update-quantity-link link-primary">
                  Update
                </span>
                <span class="delete-quantity-link link-primary js-delete-link" data-product-id="${matchingItem.id}" >
                  Delete
                </span>
              </div>
            </div>
  
            <div class="delivery-options">
              <div class="delivery-options-title">
                Choose a delivery option:
              </div>
              ${deliveryOptionsHTML(matchingItem, cartitem)}
            </div>
          </div>
        </div>
    `;
  });
  
  function deliveryOptionsHTML(matchingItem, cartitem) {
    let html = ``;
    deliveryOptions.forEach((deliveryOption) => {
      const today = dayjs();
      const deliveryDate = today.add(deliveryOption.deliveryDate, 'day');
      
      const dateString = deliveryDate.format('dddd,MMMM, D');
      let priceCents = deliveryOption.priceCents === 0 ? 'FREE' : `${formatPrice(deliveryOption.priceCents)} - `;
      
      const isChecked = deliveryOption.id === cartitem.deliveryOptionId;
      
      html += 
      `
        <div class="delivery-option js-delivery-option"
          data-product-id="${matchingItem.id}"
          data-delivery-option-id="${deliveryOption.id}">
          <input type="radio"
          ${isChecked ? 'checked' : ''}
            class="delivery-option-input"
            name="delivery-option-${matchingItem.id}">
          <div>
            <div class="delivery-option-date">
              ${dateString}
            </div>
            <div class="delivery-option-price">
              $${priceCents} - Shipping
            </div>
          </div>
        </div>
    `;
    });
    return html;
  }

  document.querySelector('.js-order-summary').innerHTML = cartSummaryHTML;
  
  document.querySelectorAll('.js-delete-link')
    .forEach((link) => {
      link.addEventListener("click", () => {
        const productId = link.dataset.productId;
        removeFromCart(productId);
        renderPaymentSummary();
        
        const container = document.querySelector(`.js-cart-item-container-${productId}`);
        container.remove();
      });
    });
   
  document.querySelectorAll('.js-delivery-option')
    .forEach((element) => {
      element.addEventListener('click', () => {
        const {productId, deliveryOptionId} = element.dataset;
        updateDeliveryOption(productId, deliveryOptionId);
        renderPaymentSummary();
        renderOrderSummary();
      });
    });
}