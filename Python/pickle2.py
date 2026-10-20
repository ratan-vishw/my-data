import pickle

# Read the pickled object from the file
with open('data.pkl', 'rb') as f:
    data_loaded = pickle.load(f)

print(data_loaded)  # Output: {'name': 'Alice', 'age': 25}
