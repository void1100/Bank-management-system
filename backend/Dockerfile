FROM node:18

# 1. Set the working directory to /app
WORKDIR /app

# 2. Copy the package files and install dependencies
# We use 'ls' command to ensure package files are visible to 'npm install'
COPY package*.json ./
RUN npm install

# 3. Copy the rest of the application code
# This copies everything from the build context (./backend) into /app in the container.
COPY . .

# 4. Expose the port
EXPOSE 4000

# 5. Run the server using the corrected path (as per your latest logs)
# The logs show the server is now looking for /app/src/server.js
CMD ["node", "src/server.js"]