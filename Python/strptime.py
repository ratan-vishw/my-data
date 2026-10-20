from datetime import datetime

date_string = "2024-12-13 15:30:00"
format_string = "%Y-%m-%d %H:%M:%S"

# Convert the string to a datetime object
dt = datetime.strptime(date_string, format_string)

print(dt)  # Output: 2024-12-13 15:30:00