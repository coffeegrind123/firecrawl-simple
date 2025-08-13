FROM python:3.11-slim

# Install system dependencies for Chrome and pydoll
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    curl \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements first
COPY ./apps/pydoll-service/requirements.txt .

# Copy pydoll source for local installation
COPY ./pydoll /app/pydoll

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./apps/pydoll-service .

# Expose port
EXPOSE 3003

# Set environment variables
ENV PYTHONPATH=/app
ENV CHROME_PATH=/usr/bin/google-chrome
ENV DISPLAY=:99

# Start virtual display and run the application
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 & python app.py"]