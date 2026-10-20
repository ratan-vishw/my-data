import pickle

# Sample Python object
data = {'name': 'Alice', 'age': 25}

# Serialize (pickle) the object and save it to a file
with open('data.pkl', 'wb') as f:
    pickle.dump(data, f)
