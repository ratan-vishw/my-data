#include<iostream>
#include<vector>
#include<climits>
using namespace std;
//kadane;s Algorithum
//Time complexity=> O(n), linear
int main (){
  vector<int> arr = {3, -4, 5, 4, 1, 7, -8};
  int size = (arr.size() - 1);
  int cs = INT_MIN, ms = 0;
  for (int i = 0; i<=size; i++){
    cs += arr[i];
    ms = max(cs, ms);
    if (cs < 0){
      cs = 0;
    }
  }
  cout<<"Maximum_subarray_sum: "<<ms<<endl;
  return 0;
}