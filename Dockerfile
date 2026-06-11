FROM node:16

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies (including dev deps for TypeScript)
COPY package*.json ./
RUN npm install --registry https://verdaccio.nodetopia.xyz

# Bundle source code
COPY . .

# Compile TypeScript to JavaScript in dist/
RUN npx tsc

# Expose the default proxy port
EXPOSE 9080

# Run the compiled server
CMD ["node", "dist/server.js"]
