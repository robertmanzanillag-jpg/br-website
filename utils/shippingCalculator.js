
export function getShippingRates(country) {
  const rates = {
    // Estados Unidos
    'US': [
      {
        name: 'USPS Standard',
        price: 800, // $8
        delivery: '5-7 business days'
      },
      {
        name: 'USPS Express',
        price: 2000, // $20
        delivery: '2-3 business days'
      }
    ],
    // Latinoamérica
    'MX': [
      {
        name: 'Standard Shipping',
        price: 1500, // $15
        delivery: '7-14 business days'
      }
    ],
    'CO': [
      {
        name: 'Standard Shipping',
        price: 2000, // $20
        delivery: '10-15 business days'
      }
    ],
    'PE': [
      {
        name: 'Standard Shipping',
        price: 2000, // $20
        delivery: '10-15 business days'
      }
    ],
    // Default para otros países
    'default': [
      {
        name: 'International Shipping',
        price: 2500, // $25
        delivery: '10-20 business days'
      }
    ]
  };

  return rates[country] || rates['default'];
}

export function formatShippingOptions(country) {
  const rates = getShippingRates(country);
  
  return rates.map(rate => ({
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: {
        amount: rate.price,
        currency: 'usd',
      },
      display_name: rate.name,
      delivery_estimate: {
        minimum: {
          unit: 'business_day',
          value: parseInt(rate.delivery.split('-')[0]),
        },
        maximum: {
          unit: 'business_day',
          value: parseInt(rate.delivery.split('-')[1]),
        },
      },
    },
  }));
}
