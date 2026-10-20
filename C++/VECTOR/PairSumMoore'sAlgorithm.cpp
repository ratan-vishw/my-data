#include <iostream>
#include <vector>
using namespace std;
int majorityElement(vector<int>& nums) {
    int count = 0, candidate = 0;
    // Phase 1: Find a candidate
    for (int num : nums) {
        if (count == 0) {
            candidate = num;
        }
        count += (num == candidate) ? 1 : -1;
    }
    // Phase 2: Verify the candidate
    count = 0;
    for (int num : nums) {
        if (num == candidate) {
            count++;
        }
    }
    return (count > nums.size() / 2) ? candidate : -1;
}
int main() {
    vector<int> arr = {2, 2, 1, 1, 1, 2, 2};
    int result = majorityElement(arr);
    if (result != -1) {
        cout << "The majority element is " << result << endl;
    } else {
        cout << "There is no majority element." << endl;
    }
    return 0;
}
