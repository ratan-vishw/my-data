fileObject = open("hello.txt", "w")
fileObject.write("Hello, World!")


try:
  fileObject = open("hello.txt", "r")
  print(fileObject.read())
  fileObject.close()
except FileNotFoundError:
  print("Error: helo.txt file not found!")
fileObject.close()