FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Build app source
RUN npm run build

EXPOSE 9080
CMD [ "node", "dist/server.js" ]
