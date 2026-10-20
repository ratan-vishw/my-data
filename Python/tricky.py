def writer():
  title = 'sir'
  name = (lambda x: title+' '+x)
  return name

who = writer()
print(who('ratan'))