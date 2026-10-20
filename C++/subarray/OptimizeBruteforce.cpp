#include<iostream>
#include<vector>
#include<climits>
using namespace std;
//optimize brute force
int main (){
  vector<int> arr = {3, -4, 5, 4, 1, 7, -8};
  int size = (arr.size() - 1);
  int max_sum = INT_MIN, curr_sum = 0;

  for (int end = 0; end<=size; end++){
      curr_sum += arr[end];
      if (curr_sum < 0){
        curr_sum = 0;
      }
      //cout<<curr_sum<<endl;
      max_sum = max(curr_sum, max_sum);
      //
      cout<<max_sum<<endl;
    }
  cout<<"maximum_subarray_sum: "<<max_sum<<endl;
  return 0;
}