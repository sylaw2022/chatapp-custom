#!/bin/bash

# Script to start Next.js dev server and ngrok tunnel
# This allows you to host the app locally and access it from the internet

echo "Starting Next.js development server..."

# Start Next.js dev server in the background
npm run dev &
DEV_PID=$!

# Wait for the server to be ready
echo "Waiting for server to start..."
sleep 5

# Check if server is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "Error: Server failed to start on port 3000"
    kill $DEV_PID 2>/dev/null
    exit 1
fi

echo "Server is running on http://localhost:3000"
echo ""
echo "Starting ngrok tunnel..."

# Start ngrok
ngrok http 3000

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $DEV_PID 2>/dev/null
    pkill ngrok 2>/dev/null
    exit 0
}

# Trap Ctrl+C
trap cleanup SIGINT SIGTERM

# Keep script running
wait













