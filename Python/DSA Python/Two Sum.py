nums = [1, 2, 0, 7, 5]
target = 7

for i in range(0,len(nums)):
    for j in range(i + 1, len(nums)):
        if nums[i] + nums[j] == target:
            print(nums[i], nums[j])

