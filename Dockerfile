# Use the official Nginx image as the base image
FROM nginx:latest

# Copy the custom index.html file to the Nginx default HTML directory
COPY index.html /usr/share/nginx/html

# Expose port 80 for incoming traffic
EXPOSE 80