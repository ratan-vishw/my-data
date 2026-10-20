import {updateProduct} from '../../data/products.js';
import {cart} from '../../data/cart.js';
import {getDeliveryOption} from '../../data/deliveryOptions.js';
import {formatPrice} from '../utils/money.js';

export function renderPaymentSummary() {
  let productPriceCents = 0;
  let shippingPriceCents = 0;
  
  cart.forEach((cartItem) => {
    const product = updateProduct(cartItem.productId);
    productPriceCents += product.priceCents * cartItem.quantity
    
    const paymentOption = getDeliveryOption(cartItem.deliveryOptionId);
    shippingPriceCents += paymentOption.priceCents;
    });
    const totalCentsBeforeTax = productPriceCents + shippingPriceCents;
    const taxCents = totalCentsBeforeTax * 0.1;
    const totalCents = totalCentsBeforeTax + taxCents;
    console.log(totalCents);
    
    const paymentSummaryHTML = 
    `
      <div class="payment-summary-title">
        Order Summary
      </div>

      <div class="payment-summary-row">
        <div>Items (3):</div>
        <div class="payment-summary-money">
        $${formatPrice(productPriceCents)}
        </div>
      </div>

      <div class="payment-summary-row">
        <div>Shipping &amp; handling:</div>
        <div class="payment-summary-money">
        $${formatPrice(shippingPriceCents)}
        </div>
      </div>

      <div class="payment-summary-row subtotal-row">
        <div>Total before tax:</div>
        <div class="payment-summary-money">
        $${formatPrice(totalCentsBeforeTax)}
        </div>
      </div>

      <div class="payment-summary-row">
        <div>Estimated tax (10%):</div>
        <div class="payment-summary-money">
        $${formatPrice(taxCents)}
        </div>
      </div>

      <div class="payment-summary-row total-row">
        <div>Order total:</div>
        <div class="payment-summary-money">
        $${formatPrice(totalCents)}
        </div>
      </div>

      <button class="place-order-button button-primary">
        Place your order
      </button>
    `;
    
    document.querySelector('.js-payment-summary').innerHTML = paymentSummaryHTML;
}