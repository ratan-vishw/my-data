decnum = int(input("Enter Number: "))
pow = 1
ans = 0
while decnum > 0:
  rem = decnum%2
  decnum //= 2
  ans += rem*pow
  pow *= 10

print(ans)