# Black Room Token System

## Overview

The Black Room website is an event management and e-commerce platform designed to manage and promote events, products, and media related to the Black Room brand. It features automated event extraction, real-time YouTube playlist integration, a professional e-commerce shop, a token claim system, comprehensive calendar functionalities for events and DJ sessions, and advanced analytics for user interactions. The platform aims to provide a unified digital experience for event-goers and customers, leveraging a sleek, industrial design aesthetic.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Design Aesthetic**: Teletech + Boiler Room industrial style with a focus on dark themes.
- **Color Scheme**: Pure black background (`#000000`), white text (`#ffffff`), secondary gray text (`#888888`), dark gray borders (`#222222`), and card backgrounds (`#111111`).
- **Typography**: Space Mono for headers and Inter for body text.
- **Header**: Responsive header injected consistently across all pages with logo, centered navigation, user/cart icons, and a backdrop blur effect.
- **Card Design**: Event, video, and shop cards feature industrial Teletech styling with corner brackets, monospace typography, and hover effects.
- **Homepage**: Features an animated CSS background, marquee banner, minimal navigation, event/video/shop carousels, and an "About" section with stats.
- **Login/Register Pages**: Incorporate Three.js liquid mesh distortion effects with rotating calendar images for a dynamic background.
- **Animations**: Includes title reveals, fade-in scroll animations using IntersectionObserver, and interactive hover effects.
- **Responsiveness**: Full mobile-responsive design with a mobile menu overlay.

### Technical Implementations
- **Backend**: Built with Node.js and Express.js, providing a RESTful API, compression, and session management.
- **Database**: PostgreSQL is used as the primary data store.
- **Session Management**: `express-session` handles user authentication.
- **Shop & E-commerce**:
    - **Product Display**: `shop.html` for catalog, `product.html` for details.
    - **Cart**: Client-side `localStorage` for cart management.
    - **Payment**: Stripe integration for checkout, utilizing `price_data` for dynamic and reliable pricing.
    - **Shipping**: Dynamic shipping options based on cart subtotal (Free for $75+, Standard, Express, Priority).
- **Event Management**:
    - **Data Sources**: `db/manual-events.json` for manually added events, `db/posh-manual-events.json` for Posh.vip URLs to scrape.
    - **Posh.vip Integration**: Daily auto-sync via cron job to scrape and integrate events, with a `posh-scraper.js` script.
    - **Calendar**: Displays YouTube videos and radio schedules, initializing at the current month with real publish times. Radio schedule merges data from Google Calendar (authoritative for Thursdays with 3 DJs at 7/8/9 PM) with local `db/radio-schedule.json` fallback for non-Thursday days.
- **Admin Tools**:
    - **Token Management**: Batch creation and claim tracking.
    - **Analytics Dashboard**: Comprehensive analytics for page views, shop events, video events, traffic, and devices, with CSV/Excel export.
    - **Bio Links Builder**: A drag-and-drop visual editor for `links.html` with various element types (links, banners, videos, headers, etc.), real-time preview, and detailed click analytics.
- **Analytics**: Universal tracking script (`js/analytics.js`) for page views, shop interactions, and video events.
- **Bio Links System**: Stores elements in a `bio_elements` table (with JSONB for metadata) and tracks clicks in `link_clicks` for detailed analytics.
- **Link Click Tracking**: Server-side redirect tracking via `/go/:id` for reliable analytics, especially for platforms like Instagram.

## External Dependencies

- **PostgreSQL**: Main database.
- **Stripe**: Payment gateway for e-commerce, using `price_data`.
- **Node.js Packages**: `express`, `pg`, `compression`, `express-session`.
- **YouTube**: Integration for video content and radio schedules (`ytdl-core` for optional direct video interaction).
- **Posh.vip**: External event platform for automated event scraping.
- **Replit Object Storage**: (Optional) For image management.
- **Nodemailer**: (Optional) For email functionalities.