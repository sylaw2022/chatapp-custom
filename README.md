This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Hosting Locally with ngrok

To host the app locally and access it from the internet using ngrok:

### Method 1: Using the Automated Script

1. Make the script executable (if not already):
   ```bash
   chmod +x start-ngrok.sh
   ```

2. Run the script:
   ```bash
   ./start-ngrok.sh
   ```

3. The script will automatically:
   - Start the Next.js development server on port 3000
   - Start ngrok tunnel
   - Display the public ngrok URL

4. Access your app:
   - **Local**: http://localhost:3000
   - **Public**: Check the ngrok URL displayed in the terminal (e.g., `https://xxxxx.ngrok-free.dev`)
   - **Note**: On first visit, ngrok free tier shows a warning page - click "Visit Site" to continue

5. View ngrok dashboard at http://localhost:4040

6. To stop: Press `Ctrl+C` in the terminal

### Method 2: Manual Steps

1. Start the development server:
   ```bash
   npm run dev
   ```

2. In a new terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

3. Copy the public URL from ngrok output and access your app from anywhere

### Prerequisites

- [ngrok](https://ngrok.com/) must be installed
- Node.js and npm installed

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
