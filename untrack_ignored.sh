#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "Checking if node_modules or dist are in the Git index..."

# 1. Check if node_modules and dist directories are in the Git index
if git ls-files --error-unmatch node_modules dist > /dev/null 2>&1; then
    echo "Found tracked node_modules or dist. Proceeding to untrack..."
    
    # 2. Remove all files from the Git index
    git rm -r --cached .
    
    # 3. Re-add all files (respecting .gitignore)
    git add .
    
    # 4. Commit the changes
    git commit -m 'Untrack node_modules and dist directories'
    
    # 5. Output success message
    echo "Success: Untracking is complete."
else
    echo "node_modules and dist are not currently tracked in the Git index."
fi
