FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install Playwright browsers
RUN npx playwright install chromium

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "api_server.js"]