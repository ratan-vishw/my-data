def fact(n):
  if n <= 1:
    return 1
  return n * fact(n-1)

print(fact(5))

#tail recursion
def tail_fact(n, accumulator=1):
  if n <=1:
    return accumulator
  return tail_fact(n - 1, accumulator * n)

print(tail_fact(5))
