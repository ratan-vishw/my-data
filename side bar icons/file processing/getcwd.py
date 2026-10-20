import os

# Get current working directory
current_directory = os.getcwd()
print(current_directory)

# Example with file operations
try:
    # Print current directory
    print("Current Directory:", os.getcwd())
    
    # Open file using relative path
    with open("hello.txt", "w") as file:
        file.write("Hello from " + os.getcwd())
        
    # Read the file
    with open("hello.txt", "r") as file:
        print("File contents:", file.read())
        
except Exception as e:
    print("Error:", e)